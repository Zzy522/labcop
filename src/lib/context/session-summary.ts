/**
 * 对话滚动摘要（上下文卸载 / Context Offloading）
 *
 * 解决原「take: 20 硬截断」丢信息的问题：
 * - 近 RECENT_RAW_MESSAGES 条保留完整原文（供本轮对话精确理解）
 * - 更早的消息达到阈值后，用一次 LLM 调用压缩成「滚动摘要」
 * - 摘要持久化到 ChatSession.summary（已有字段），下次请求先吸收旧摘要，再增量压缩
 *
 * ChatSession 已有字段：
 * - summary: 滚动摘要文本（非空即代表已有更早对话被压缩过）
 * - summarizedMessageIds: 已摘要消息 id 的 JSON 数组（增量压缩去重依据）
 * - tokenEstimate: 粗略 token 估算
 *
 * 设计约束：
 * - 摘要生成失败必须降级为返回原文（不阻塞主对话）
 * - 摘要 LLM 调用只在「待压缩区条数/字符数」达标时触发，普通请求零额外调用
 * - 摘要只对纯文本/Agent 链路生效（图片走 VLM，本模块不参与）
 */
import type { PrismaClient } from '@/generated/prisma/client';
import { fetchUpstream } from '@/lib/upstream-fetch';
import type { TraceRecorder } from '@/lib/agent/trace';

/** 最近保留原文的消息条数 */
export const RECENT_RAW_MESSAGES = 6;
/** 未摘要的「更早消息」达到该条数即触发一次摘要压缩 */
const STALE_TRIGGER_COUNT = 4;
/** 摘要输入（旧摘要 + 新消息文本）的字符上限 */
const SOURCE_CHAR_CAP = 8000;
/** 摘要 LLM 调用超时（毫秒）。摘要失败即降级，不重试，避免长时间阻塞主对话 */
const SUMMARY_TIMEOUT_MS = 20_000;
/** 摘要输出 max_tokens */
const SUMMARY_MAX_TOKENS = 800;

export interface SessionMessageLite {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}

export interface LlmLikeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ConversationContext {
  /** 近 RECENT_RAW_MESSAGES 条原文（正序），完整注入本轮对话 */
  recentMessages: SessionMessageLite[];
  /** 滚动摘要（已有或本次生成成功时非空），注入 system */
  summary: string | null;
  /** 摘要生成失败时降级补充的更早原文（早于 recentMessages，正序） */
  fallbackMessages: SessionMessageLite[];
  /** 本次请求是否实际触发了一次摘要压缩 */
  summarizedNow: boolean;
}

const SUMMARY_PROMPT = `你是对话摘要助手。请把「旧摘要」与「新对话片段」合并压缩成一份新的结构化摘要。

要求：
1. 保留：关键结论、已做决定、待办/未决事项、涉及的关键专有名词（化合物编号/试剂名/课题名/靶点/人名等，必须保留原始写法，如 XY-001、GSPT1）
2. 可丢弃：寒暄、重复表达、与主题无关的细节
3. 使用中文，紧凑 Markdown 列表
4. 输出固定为以下四节（不要输出其他内容）：
- 关键结论
- 已做决定
- 未决事项/待办
- 涉及专有名词

旧摘要：
"""
{{OLD_SUMMARY}}
"""

新对话片段：
"""
{{NEW_MESSAGES}}
"""

新的合并摘要：`;

/** 粗略 token 估算（中文场景约 2 字符/token） */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

function parseSummarizedIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) return new Set(arr.filter((v): v is string => typeof v === 'string'));
  } catch {
    // 数据损坏按空处理
  }
  return new Set();
}

/**
 * 装载会话上下文：近 6 条原文 + 更早对话滚动摘要。
 * 副作用：当待压缩区达标时调用一次 LLM 生成新摘要并写回 ChatSession。
 */
export async function buildConversationContext(params: {
  excludeMessageId?: string;
  trace?: TraceRecorder;
  sessionId: string;
  userId: string;
  prisma: PrismaClient;
  llmConfig: LlmLikeConfig | null;
}): Promise<ConversationContext> {
  const { sessionId, userId, prisma, llmConfig } = params;

  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId, deletedAt: null },
    select: { id: true, summary: true, summarizedMessageIds: true },
  });
  if (!session) {
    return { recentMessages: [], summary: null, fallbackMessages: [], summarizedNow: false };
  }

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId, ...(params.excludeMessageId ? { id: { not: params.excludeMessageId } } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  const summarizedIds = parseSummarizedIds(session.summarizedMessageIds);
  const pending = messages.filter((m) => !summarizedIds.has(m.id));

  // 最近 N 条原文；更早未摘要消息进入「待压缩区」
  const recentMessages = pending.slice(-RECENT_RAW_MESSAGES);
  const staleMessages = pending.slice(0, -RECENT_RAW_MESSAGES);

  const oldSummary = session.summary || '';
  const staleText = staleMessages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n');

  // 触发条件：待压缩区有内容，且条数达标或字符超预算（旧摘要 + 新消息）
  const shouldSummarize =
    staleMessages.length > 0 &&
    (staleMessages.length >= STALE_TRIGGER_COUNT || oldSummary.length + staleText.length > SOURCE_CHAR_CAP);

  if (!shouldSummarize || !llmConfig) {
    return {
      recentMessages,
      summary: oldSummary || null,
      fallbackMessages: [],
      summarizedNow: false,
    };
  }

  try {
    const summarize = () => summarizeWithLlm({
      llmConfig,
      oldSummary,
      staleMessages: staleMessages.map((m) => ({ role: m.role, content: m.content })),
    });
    const newSummary = params.trace
      ? await params.trace.span('model', 'history.summary', { messageIds: staleMessages.map(m => m.id), sourceCharacterCap: SOURCE_CHAR_CAP }, summarize, result => ({ characters: result.length }))
      : await summarize();

    // 滚动：把待压缩区消息 id 并入已摘要集合
    const newSummarizedIds = [...summarizedIds, ...staleMessages.map((m) => m.id)];
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        summary: newSummary,
        summarizedMessageIds: JSON.stringify(newSummarizedIds),
      },
    });

    return { recentMessages, summary: newSummary, fallbackMessages: [], summarizedNow: true };
  } catch (error) {
    // 降级：摘要失败返回更多原文，保证上下文不丢失（近似原 take:20 行为）
    console.warn('[session-summary] 摘要生成失败，降级返回原文:', error);
    const fallbackCount = Math.max(0, 20 - RECENT_RAW_MESSAGES);
    return {
      recentMessages,
      summary: oldSummary || null,
      fallbackMessages: staleMessages.slice(-fallbackCount),
      summarizedNow: false,
    };
  }
}

/** 单次 LLM 摘要调用（失败抛错，由调用方降级） */
async function summarizeWithLlm(params: {
  llmConfig: LlmLikeConfig;
  oldSummary: string;
  staleMessages: Array<{ role: string; content: string }>;
}): Promise<string> {
  const newMessages = params.staleMessages
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
    .join('\n')
    .slice(0, SOURCE_CHAR_CAP);

  const prompt = SUMMARY_PROMPT
    .replace('{{OLD_SUMMARY}}', params.oldSummary.slice(0, SOURCE_CHAR_CAP) || '（无）')
    .replace('{{NEW_MESSAGES}}', newMessages);

  const resp = await fetchUpstream(`${params.llmConfig.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: params.llmConfig.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: SUMMARY_MAX_TOKENS,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`摘要 LLM 调用失败（${resp.status}）`);
  }
  const data = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content || '';
  const trimmed = content.trim();
  if (trimmed.length < 20) throw new Error('摘要输出过短');
  return trimmed;
}
