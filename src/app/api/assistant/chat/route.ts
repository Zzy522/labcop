import { capturePolicy } from '@/lib/agent/diagnostics';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse, after } from 'next/server';
import { readAssistantAttachments } from '@/lib/assistant-attachments';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { getEffectiveLlmConfig, getEffectiveVlmConfig } from '@/lib/api-config';
import { Errors, ErrorCategory } from '@/lib/errors';
import { reportError } from '@/lib/error-report';
import { createTrace, traceJson, hash, HARNESS_VERSION } from '@/lib/agent/trace';
import { runAgentLoop } from '@/lib/agent/loop';
import { AGENT_TOOLS } from '@/lib/agent/tools';
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit';
import {
  sanitizeUserInput,
  wrapContextAsData,
  detectPromptLeak,
  INJECTION_DEFENSE_PROMPT,
} from '@/lib/prompt-security';
import { extractEntities } from '@/lib/memory/entity-extractor';
import { upsertEntities, searchRelevantEntities, buildEntityContext } from '@/lib/memory/service';
import { buildConversationContext } from '@/lib/context/session-summary';
import { loadUserProfileContext } from '@/lib/memory/user-profile';
import { shouldGatherDataContext, shouldUseAgentTools } from '@/lib/agent/intent';
import { redactInternalIdentifiers } from '@/lib/agent/output-safety';
import { streamVisionAnalysis, type VisionInputImage } from '@/lib/ai/vision-stream';
import { getAssistantSystemPrompt, normalizeAssistantMode, type AssistantMode } from '@/lib/agent/prompts';

interface IncomingMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const MAX_VISION_IMAGES = 5;
const MAX_IMAGE_DATA_URL_LENGTH = 7 * 1024 * 1024;

/**
 * POST /api/assistant/chat
 * 智能助手聊天接口（OpenAI 兼容 + SSE 流式输出 + ChatSession 持久化）
 *
 * 安全（P0）：
 * - 速率限制：每用户 10 次/分钟突发
 * - Prompt Injection 防护：输入清洗 + 上下文数据隔离 + 系统提示防御 + 输出泄露检测
 * - LLM 调用超时：60s，避免连接挂起
 *
 * 请求体：
 *   - messages: IncomingMessage[]（必填，前端当前会话的消息列表）
 *   - role: 'admin' | 'user'（必填）
 *   - sessionId?: string（可选，未传则创建新会话）
 *
 * 响应：
 *   - Content-Type: text/event-stream
 *   - SSE 数据格式：data: { stage, content?, sessionId?, error? }\n\n
 *   - stage: 'session_created' | 'routing' | 'retrieving' | 'vision_status' | 'vision_progress' | 'delta' | 'done' | 'error'
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  const labId = authResult.labId;
  if (!labId) {
    return NextResponse.json({ error: '当前用户未关联实验室' }, { status: 403 });
  }

  // ── 速率限制（per-user）──
  const rl = checkRateLimit(
    `${authResult.userId}:assistant-chat`,
    RATE_LIMIT_PRESETS.assistantChat
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `请求过于频繁，请 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后再试`, category: 'QUOTA_EXCEEDED' },
      { status: 429 }
    );
  }

  const body = await request.json();
  const messages: IncomingMessage[] = body.messages || [];
  const requestRole: 'admin' | 'user' = body.role === 'admin' ? 'admin' : 'user';
  const assistantMode = normalizeAssistantMode(body.assistantMode);
  const sessionId: string | undefined = body.sessionId;
  const images: VisionInputImage[] = Array.isArray(body.images)
    ? body.images.filter((image: unknown): image is VisionInputImage => {
        if (!image || typeof image !== 'object') return false;
        const candidate = image as { name?: unknown; dataUrl?: unknown };
        return typeof candidate.name === 'string' && typeof candidate.dataUrl === 'string';
      })
    : [];
  const baseSystemPrompt = getAssistantSystemPrompt(assistantMode);
  // 追加注入防御提示
  const systemPrompt = `${baseSystemPrompt}\n\n${INJECTION_DEFENSE_PROMPT}`;

  if (messages.length === 0) {
    return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
  }
  if (images.length > MAX_VISION_IMAGES) {
    return NextResponse.json({ error: `最多上传 ${MAX_VISION_IMAGES} 张图片` }, { status: 400 });
  }
  for (const image of images) {
    if (!image.dataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: `图片「${image.name || '未命名'}」格式不正确` }, { status: 400 });
    }
    if (image.dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return NextResponse.json({ error: `图片「${image.name || '未命名'}」过大（单张不超过 5MB）` }, { status: 400 });
    }
  }

  // 取最后一条用户消息作为本次输入
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) {
    return NextResponse.json({ error: '未找到用户消息' }, { status: 400 });
  }

  // ── Prompt Injection 防护：清洗用户输入（截断 + 注入模式标记 + 控制字符过滤）──
  const sanitized = sanitizeUserInput(lastUserMessage.content);
  if (sanitized.flagged) {
    console.warn('[assistant] 检测到疑似 prompt injection', {
      userId: authResult.userId,
      reasons: sanitized.reasons,
    });
    // 不直接拒绝：系统提示已指示 LLM 拒绝此类指令；记录日志便于审计
  }
  const attachments = await readAssistantAttachments(body.attachmentIds, authResult.userId, labId);
  const attachmentContext = attachments.map(file => wrapContextAsData(JSON.stringify({
    file: file.name, warning: file.warning, totalCharacters: file.text.length,
    scope: file.text.length > 12000 ? '只读取前 12000 字符，不能声称已阅读全文' : '已抽取的文字正文（不含嵌入图片）',
    text: sanitizeUserInput(file.text.slice(0, 12000)).text,
  }))).join('\n');
  const userContent = sanitized.text + (attachmentContext ? '\n[附件：' + attachments.map(file => file.name).join('、') + ']\n\n' + attachmentContext : '');

  // 获取或创建 ChatSession
  let session: { id: string; labId: string | null; assistantMode: string };
  if (sessionId) {
    const existing = await prisma.chatSession.findFirst({
      where: { id: sessionId, userId: authResult.userId, labId, deletedAt: null },
      select: { id: true, labId: true, assistantMode: true },
    });
    if (!existing) {
      return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
    }
    if (existing.assistantMode !== assistantMode) {
      return NextResponse.json(
        { error: '当前会话属于另一助手模式，请新建会话后重试' },
        { status: 409 },
      );
    }
    session = existing;
  } else {
    const created = await prisma.chatSession.create({
      data: {
        userId: authResult.userId,
        labId,
        role: requestRole,
        assistantMode,
        title: userContent.slice(0, 30),
      },
      select: { id: true, labId: true, assistantMode: true },
    });
    session = created;
  }

  const hasImages = images.length > 0;
  // 智能体能力路由：图片必须走显式配置的 VLM；纯文本走 LLM。
  const modelConfig = hasImages
    ? await getEffectiveVlmConfig(authResult.labId, authResult.userId, prisma)
    : await getEffectiveLlmConfig(authResult.labId, authResult.userId, prisma);

  if (!modelConfig) {
    return NextResponse.json(
      {
        error: hasImages
          ? '尚未接入 VLM：请前往「API 配置」填写支持图片理解的 VLM API Key 后再试。'
          : 'LLM 未接入：未配置 LLM API 凭证。请前往「API 配置」页面配置 LLM（个人或实验室级），接入后再试。',
        actionUrl: authResult.isAdmin ? '/admin/api-config' : '/user/api-config',
        actionText: hasImages ? '前往配置 VLM' : '前往配置 LLM',
        sessionId: session.id,
      },
      { status: 400 }
    );
  }

  const policy = await capturePolicy(labId);
  const diagnosticId = randomUUID();
  // Serialize acceptance: two tabs must not create overlapping turns in one session.
  const accepted = await prisma.$transaction(async (tx) => {
    if (await tx.assistantRun.findFirst({ where: { message: { sessionId: session.id }, status: { in: ['RUNNING', 'CANCEL_REQUESTED'] }, createdAt: { gt: new Date(Date.now() - 600000) } } })) return null;
    // 写入用户消息到 ChatMessage（使用清洗后的内容）
    await tx.chatMessage.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: hasImages ? `${userContent}\n[附带 ${images.length} 张图片]` : userContent,
        userId: authResult.userId,
      },
    });

    // 更新会话活跃时间
    await tx.chatSession.update({
      where: { id: session.id },
      data: { lastActiveAt: new Date() },
    });

    // 创建 SSE 流（Agent 循环内部组装 systemMessages + conversationMessages）
    const assistantMessage = await tx.chatMessage.create({ data: {
      sessionId: session.id, role: 'assistant', assistantUserId: authResult.userId,
      content: '',
    } });
    const run = await tx.assistantRun.create({ data: {
      id: diagnosticId, captureContent: policy.captureContent, expiresAt: new Date(Date.now() + policy.retentionDays * 86400000),
      messageId: assistantMessage.id, userId: authResult.userId, labId,
      release: process.env.APP_RELEASE || 'development-unversioned', harness: HARNESS_VERSION,
      model: modelConfig.model, mode: assistantMode,
      input: traceJson({ question: policy.captureContent ? userContent : undefined, promptHash: hash(systemPrompt), toolSchemaHash: hash(JSON.stringify(AGENT_TOOLS)),
        attachments: attachments.map(file => ({ id: file.id, name: policy.captureContent ? file.name : undefined, totalCharacters: file.text.length, includedCharacters: Math.min(file.text.length, 12000), warning: file.warning })),
        images: images.map(image => ({ name: policy.captureContent ? image.name : undefined, sha256: hash(image.dataUrl), bodyRetained: false })),
        historyPolicy: hasImages ? 'VLM: no conversation history' : 'recent raw messages + rolling summary / fallback',
      }, [modelConfig.apiKey]),
    } });
    return { assistantMessage, run };
  });
  if (!accepted) return NextResponse.json({ error: '该会话仍在生成，请等待完成或停止后再发送。' }, { status: 409 });
  const { assistantMessage, run } = accepted;
  const trace = createTrace(run.id, [modelConfig.apiKey], policy.captureContent);
  const encoder = new TextEncoder();
  const execute = async (controller?: ReadableStreamDefaultController<Uint8Array>) => {
      const generation = new AbortController();
      const timeout = setTimeout(() => generation.abort(new Error('生成超过 8 分钟，请重试')), 480000);
      let disconnected = false;
      // 客户端断开后 enqueue/close 会抛 TypeError，需容错
      const send = (data: Record<string, unknown>) => {
        if (!controller || disconnected) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch (err) {
          disconnected = true; void err;
        }
      };

      // 先发送 sessionId（前端需要保存）
      send({ stage: 'session_created', sessionId: session.id, messageId: assistantMessage.id, runId: run.id });
      send({ stage: 'routing', assistantMode });

      let firstTokenMs: number | null = null;
      let fullContent = '';
      let checkpoint = Promise.resolve();
      let checkpointBusy = false;
      const checkpointTimer = setInterval(() => {
        if (checkpointBusy) return;
        checkpointBusy = true;
        const content = detectPromptLeak(fullContent) ? '[回复包含受保护内容，已隐藏。]' : fullContent;
        checkpoint = (async () => {
          const state = await prisma.assistantRun.findUnique({ where: { id: run.id }, select: { status: true, message: { select: { session: { select: { deletedAt: true } } } } } });
          if (!state || state.status === 'CANCEL_REQUESTED' || state.message.session.deletedAt) generation.abort();
          if (fullContent) await prisma.chatMessage.update({ where: { id: assistantMessage.id }, data: { content } });
        })().catch(error => console.error('[assistant] checkpoint failed', error))
          .finally(() => { checkpointBusy = false; });
      }, 2000);
      try {
        const initial = await prisma.assistantRun.findUnique({ where: { id: run.id }, select: { status: true } });
        if (!initial || initial.status === 'CANCEL_REQUESTED') generation.abort();
        generation.signal.throwIfAborted();
        // Function Calling Agent 循环：只读查表（配合记忆系统实体检索）+ 防死循环
        // maxRounds=5（最多循环轮次）、maxToolCalls=10（最多工具调用总数），超限截断强制收尾
        const startedAt = run.createdAt.getTime();
        // ── 对话上下文装载：近 6 条原文 + 更早对话滚动摘要（上下文卸载）──
        // 图片场景走 VLM（不注入历史，保持轻量），纯文本/Agent 场景做滚动摘要
        let conversationCtx: Awaited<ReturnType<typeof buildConversationContext>> = {
          recentMessages: [],
          summary: null,
          fallbackMessages: [],
          summarizedNow: false,
        };
        let profileContext = '';
        if (!hasImages) {
          conversationCtx = await trace.span('context', 'conversation.summary', {}, () => buildConversationContext({
              excludeMessageId: assistantMessage.id,
              trace,
            sessionId: session.id,
            userId: authResult.userId,
            prisma,
            llmConfig: modelConfig,
          }), value => ({ messageIds: [...value.fallbackMessages, ...value.recentMessages].map(m => m.id), summarizedNow: value.summarizedNow }));
          profileContext = await loadUserProfileContext(authResult.userId, prisma, labId);
        }
        // 上下文消息 = 摘要降级时补充的更早原文 + 最近 6 条原文（正序）
        const contextMessages = [...conversationCtx.fallbackMessages, ...conversationCtx.recentMessages];

        // 本地意图路由不增加模型调用：只有实时数据问题才启用工具、上下文和实体检索。
        const modeNeedsData = shouldGatherDataContext(
          assistantMode,
          userContent,
          contextMessages.slice(0, -1).map((message) => message.content)
        );
        const enableTools = !hasImages && shouldUseAgentTools(userContent);
        const needsContext = !hasImages && (enableTools || modeNeedsData);



        const context = needsContext
          ? await trace.span('context', 'authorized.lab-data', { assistantMode }, () => gatherContext(labId, authResult.isAdmin, assistantMode, authResult.userId))
          : '';
        const relevantEntities = needsContext
          ? await searchRelevantEntities(authResult.userId, labId, userContent)
          : [];
        const entityContext = buildEntityContext(relevantEntities);
        if (needsContext) send({ stage: 'retrieving', assistantMode });
        const systemMessages: Array<{ role: 'system'; content: string }> = [
          { role: 'system', content: systemPrompt },
          ...(conversationCtx.summary
            ? [{ role: 'system' as const, content: `对话历史摘要（来自更早对话的上下文卸载）：\n${conversationCtx.summary}` }]
            : []),
          ...(context ? [{ role: 'system' as const, content: `当前实验室数据上下文：\n${wrapContextAsData(context)}` }] : []),
          ...(entityContext ? [{ role: 'system' as const, content: wrapContextAsData(entityContext) }] : []),
          ...(profileContext ? [{ role: 'system' as const, content: profileContext }] : []),
        ];
        await prisma.assistantRun.update({ where: { id: run.id }, data: {
          input: traceJson({ ...JSON.parse(run.input),
            conversation: contextMessages.map(m => ({ id: m.id, role: m.role, content: policy.captureContent ? redactInternalIdentifiers(m.content) : undefined })),
            systemContexts: !policy.captureContent || hasImages ? [] : systemMessages.slice(1),
            enableTools, maxRounds: 5, maxToolCalls: 10,
          }, [modelConfig.apiKey]),
        } }).catch(() => console.error("[trace] input persistence failed", run.id));
        let truncated = false;
        if (hasImages) {
          const visionStartedAt = Date.now();
          send({ stage: 'vision_status', message: `已接收 ${images.length} 张图片，正在准备视觉分析…` });
          const progressTimer = setInterval(() => {
            const elapsedSeconds = Math.max(1, Math.round((Date.now() - visionStartedAt) / 1000));
            send({
              stage: 'vision_progress',
              elapsedSeconds,
              message: elapsedSeconds >= 45
                ? `复杂图片仍在分析，已等待 ${elapsedSeconds} 秒；可随时停止后裁剪关键区域重试。`
                : `正在识别图片中的结构、箭头和反应条件，已等待 ${elapsedSeconds} 秒…`,
            });
          }, 10_000);
          try {
            fullContent = await trace.span('model', 'vision.stream', { model: modelConfig.model, imageCount: images.length }, () => streamVisionAnalysis({
              baseUrl: modelConfig.baseUrl,
              apiKey: modelConfig.apiKey,
              model: modelConfig.model,
              systemPrompt,
              question: userContent,
              images,
              signal: generation.signal,
              onStatus: ({ stage: phase, ...status }) => send({ stage: 'vision_status', phase, ...status }),
              onDelta: (delta) => { firstTokenMs ??= Date.now() - run.createdAt.getTime(); fullContent += delta; send({ stage: 'delta', content: delta }); },
            }), result => ({ characters: result.length }));
          } finally {
            clearInterval(progressTimer);
          }
        } else {
          const result = await runAgentLoop({
            trace, signal: generation.signal,
            baseUrl: modelConfig.baseUrl,
            apiKey: modelConfig.apiKey,
            model: modelConfig.model,
            systemMessages,
            conversationMessages: contextMessages.map((m) => ({ role: m.role, content: redactInternalIdentifiers(m.content) })),
            ctx: { labId, userId: authResult.userId, isAdmin: authResult.isAdmin },
            maxRounds: 5,
            maxToolCalls: 10,
            enableTools,
            onDelta: (delta) => {
              firstTokenMs ??= Date.now() - run.createdAt.getTime();
              fullContent += delta;
              send({ stage: 'delta', content: delta });
            },
          });
          fullContent = result.finalContent;
          truncated = result.truncated;
        }

        generation.signal.throwIfAborted();
        const latest = await prisma.assistantRun.findUnique({ where: { id: run.id }, select: { status: true } });
        if (latest?.status === 'CANCEL_REQUESTED') { generation.abort(); generation.signal.throwIfAborted(); }
        // ── 输出泄露检测：若 LLM 输出疑似泄露系统提示，不持久化原始内容 ──
        let contentToPersist = fullContent;
        if (fullContent && detectPromptLeak(fullContent)) {
          console.warn('[assistant] 检测到 LLM 输出疑似泄露系统提示，已脱敏持久化', {
            userId: authResult.userId,
            sessionId: session.id,
          });
          contentToPersist = '[系统检测到本次回复可能包含系统提示内容，出于安全考虑已隐藏。请重新提问。]';
        }

        // 写入 assistant 消息到 ChatMessage
        const latencyMs = Date.now() - startedAt;
        clearInterval(checkpointTimer);
        await checkpoint;
        if (contentToPersist) {
          await prisma.chatMessage.update({
            where: { id: assistantMessage.id },
            data: {
              content: contentToPersist,
              latencyMs,
            },
          });
          await prisma.chatSession.update({
            where: { id: session.id },
            data: {
              tokenEstimate: { increment: Math.ceil(contentToPersist.length / 2) },
            },
          });
        }

        // 异步提取实体到记忆系统（不阻塞响应，失败静默）
        void (async () => {
          try {
            const combined = `${userContent}\n${fullContent}`.slice(0, 4000);
            const entities = await extractEntities(
              combined,
              labId,
              authResult.userId,
              prisma
            );
            if (entities.length > 0) {
              await upsertEntities(authResult.userId, labId, entities);
            }
          } catch (e) {
            console.warn('[assistant] 实体提取失败（非阻塞）:', e);
          }
        })();

        await prisma.assistantRun.update({ where: { id: run.id }, data: { status: truncated ? 'TRUNCATED' : 'OK', firstTokenMs, output: policy.captureContent ? traceJson(contentToPersist, [modelConfig.apiKey]) : "", durationMs: Date.now() - startedAt, finishedAt: new Date() } }).catch(() => console.error('[trace] completion persistence failed', run.id));
        send({
          stage: 'done', messageId: assistantMessage.id, runId: run.id,
          sessionId: session.id,
          truncated,
          capability: hasImages ? 'vlm' : enableTools ? 'agent-tools' : needsContext ? 'context-grounded' : 'llm-fast',
          assistantMode,
        });
      } catch (error) {
        clearInterval(checkpointTimer);
        await checkpoint;
        await prisma.chatMessage.update({ where: { id: assistantMessage.id }, data: {
          content: (detectPromptLeak(fullContent) ? '[受保护内容已隐藏]' : fullContent) + (generation.signal.aborted && generation.signal.reason?.name === 'AbortError' ? '\n\n[已停止生成]' : '\n\n[生成失败，已保留现有内容。可重新提问。]'),
        } }).catch(e => console.error('[assistant] failed to persist interrupted state', e));
        await prisma.assistantRun.update({ where: { id: run.id }, data: { status: generation.signal.aborted && generation.signal.reason?.name === 'AbortError' ? 'CANCELLED' : 'ERROR', output: policy.captureContent ? traceJson(detectPromptLeak(fullContent) ? '[受保护内容已隐藏]' : fullContent, [modelConfig.apiKey]) : '', error: policy.captureContent ? traceJson(error instanceof Error ? error.message : 'Unknown error', [modelConfig.apiKey]) : 'RUN_ERROR', durationMs: Date.now() - run.createdAt.getTime(), finishedAt: new Date() } }).catch(() => console.error('[trace] run finalization failed', run.id));
        const safeError = traceJson(error instanceof Error ? error.message : 'Unknown error', [modelConfig.apiKey]);
        console.error('[assistant] 流式输出失败:', { runId: run.id, error: safeError });
        reportError(new Error(safeError), { tag: 'assistant-chat', extra: { sessionId: session.id, runId: run.id } });
        const appError =
          error instanceof Error && 'category' in error
            ? error
            : Errors.upstreamError(
                error instanceof Error ? error.message : 'LLM 调用失败'
              );
        send({
          stage: 'error',
          error: JSON.parse(traceJson(appError.message, [modelConfig.apiKey])),
          category: (appError as { category: ErrorCategory }).category,
        });
      } finally {
        clearInterval(checkpointTimer);
        clearTimeout(timeout);
        // 客户端已断开时 close() 会抛 TypeError，吞掉即可
        try {
          controller?.close();
        } catch (err) {
          console.warn('[assistant] SSE close 失败（客户端可能已断开）:', err);
        }
      }
  };
  if (body.background === true) {
    after(() => execute());
    return NextResponse.json({ sessionId: session.id, messageId: assistantMessage.id, runId: run.id }, { status: 202 });
  }
  // Compatibility with existing SSE clients; disconnecting no longer cancels the task.
  const stream = new ReadableStream<Uint8Array>({ start: execute });
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 禁用 Nginx 缓冲
    },
  });
});

/**
 * 收集当前实验室的上下文数据
 */
async function gatherContext(
  labId: string | undefined,
  isAdmin: boolean,
  assistantMode: AssistantMode,
  userId: string,
): Promise<string> {
  if (!labId) return '未分配实验室';

  if (assistantMode === 'RESEARCH') {
    try {
      const projects = await prisma.researchProject.findMany({
        where: {
          labId,
          deletedAt: null,
          ...(!isAdmin ? { members: { some: { userId } } } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: {
          name: true,
          description: true,
          objective: true,
          status: true,
          version: true,
          updatedAt: true,
          members: { select: { role: true, user: { select: { name: true } } } },
          tasks: {
            where: { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 15,
            select: { name: true, status: true, priority: true, progress: true, dueDate: true, blockedReason: true, version: true },
          },
          documents: {
            where: { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            take: 8,
            select: {
              title: true,
              docType: true,
              description: true,
              updatedAt: true,
              versions: {
                orderBy: { version: 'desc' },
                take: 1,
                select: {
                  version: true,
                  fileName: true,
                  status: true,
                  submittedAt: true,
                  extractedText: true,
                  aiSummary: true,
                },
              },
            },
          },
          weeklyReports: {
            orderBy: [{ weekStart: 'desc' }, { createdAt: 'desc' }],
            take: 8,
            select: {
              weekStart: true,
              title: true,
              content: true,
              blockers: true,
              nextPlan: true,
              createdAt: true,
              author: { select: { name: true } },
              attachments: {
                orderBy: { createdAt: 'asc' },
                select: { fileName: true, mimeType: true, fileSize: true, createdAt: true },
              },
            },
          },
          compounds: {
            take: 10,
            select: {
              compound: {
                select: {
                  name: true,
                  commonName: true,
                  casNumber: true,
                  smiles: true,
                  molecularFormula: true,
                  molecularWeight: true,
                  updatedAt: true,
                  reagent: { select: { name: true, casNumber: true, smiles: true } },
                },
              },
            },
          },
          changeRequests: { where: { status: 'PENDING' }, select: { status: true } },
        },
      });
      const compoundCount = await prisma.compound.count({ where: { labId } });
      return JSON.stringify({
        scope: isAdmin ? '本实验室全部课题' : '当前用户参与课题',
        projectCount: projects.length,
        compoundKnowledgeCount: compoundCount,
        projects: projects.map((project) => ({
          ...project,
          documents: project.documents.map((document) => ({
            ...document,
            description: document.description?.slice(0, 800) ?? null,
            versions: document.versions.map((version) => ({
              ...version,
              extractedText: version.extractedText?.slice(0, 2200) ?? null,
              aiSummary: version.aiSummary?.slice(0, 1200) ?? null,
            })),
          })),
          weeklyReports: project.weeklyReports.map((report) => ({
            ...report,
            content: report.content.slice(0, 1800),
            blockers: report.blockers?.slice(0, 800) ?? null,
            nextPlan: report.nextPlan?.slice(0, 800) ?? null,
          })),
          pendingChangeRequestCount: project.changeRequests.length,
          changeRequests: undefined,
        })),
      });
    } catch (error) {
      console.warn('[assistant] 科研上下文获取失败:', error);
      return '科研上下文暂时无法读取，请基于用户提供的信息回答并说明数据缺失。';
    }
  }

  const now = new Date();
  const thirtyDaysLater = new Date(now);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  try {
    const [reagents, devices, pendingReservations, pendingInspections, allReagents] = await Promise.all([
      prisma.reagent.count({ where: { labId } }),
      prisma.device.count({ where: { labId } }),
      prisma.deviceReservation.count({
        where: { device: { labId }, status: 'PENDING' },
      }),
      prisma.inspectionAssignment.count({
        where: { assignee: { labId }, status: { in: ['ASSIGNED', 'SUBMITTED'] } },
      }),
      prisma.reagent.findMany({
        where: { labId },
        select: { name: true, casNumber: true, stockQuantity: true, minStock: true, expiryDate: true, riskLevel: true, isControlled: true },
      }),
    ]);

    const lowStockReagents = allReagents.filter((r) => r.stockQuantity <= r.minStock);
    const expiringReagents = allReagents.filter(
      (r) => r.expiryDate && new Date(r.expiryDate) <= thirtyDaysLater
    );
    const expiredCount = expiringReagents.filter((r) => r.expiryDate && new Date(r.expiryDate) < now).length;
    const lowStockCount = lowStockReagents.length;
    const controlledCount = allReagents.filter((r) => r.isControlled).length;
    const highRiskCount = allReagents.filter((r) => r.riskLevel === 'HIGH').length;
    const alerts = [...lowStockReagents, ...expiringReagents].slice(0, 10);

    const baseLines = [
      `用户角色: ${isAdmin ? '管理员' : '实验员'}`,
      `试剂总数: ${reagents}（其中管制品 ${controlledCount} 项、高危 ${highRiskCount} 项）`,
      `设备总数: ${devices}`,
      `低库存试剂: ${lowStockCount} 项`,
      `临期/过期试剂: ${expiredCount} 项`,
      `待审批设备预约: ${pendingReservations} 项`,
      `进行中巡检: ${pendingInspections} 项`,
      alerts.length > 0
        ? `需关注试剂: ${alerts.map((r) => `${r.name}(${r.casNumber || '无CAS'})`).join('、')}`
        : '无特别需关注试剂',
    ];

    // 管理员视角：附加审批与入组申请上下文
    if (isAdmin) {
      const [pendingRequisitions, pendingDocuments, pendingJoinRequests, unresolvedRiskEvents] = await Promise.all([
        prisma.requisition.count({
          where: { labId, status: { in: ['PENDING', 'NEEDS_CONFIRM'] } },
        }),
        prisma.document.count({
          where: { labId, status: 'PENDING' },
        }),
        prisma.user.count({
          where: { role: 'MEMBER', labId: null },
        }),
        prisma.riskEvent.count({
          where: { labId, isResolved: false },
        }),
      ]);
      baseLines.push(
        `待审批试剂领用: ${pendingRequisitions} 项`,
        `待确认单据: ${pendingDocuments} 项`,
        `待处理入组申请: ${pendingJoinRequests} 人`,
        `未解决风险事件: ${unresolvedRiskEvents} 项`
      );
    }

    return baseLines.join('\n');
  } catch {
    return '上下文数据获取失败';
  }
}
