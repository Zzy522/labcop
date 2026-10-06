import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { getProjectAccess } from '@/lib/research/projects';
import { projectSummarySchema } from '@/lib/validations/project';
import { getEffectiveLlmConfig, getEffectiveVlmConfig } from '@/lib/api-config';
import { runAgentLoop } from '@/lib/agent/loop';
import { getAssistantSystemPrompt } from '@/lib/agent/prompts';
import { streamVisionAnalysis } from '@/lib/ai/vision-stream';
import { sanitizeUserInput, wrapContextAsData } from '@/lib/prompt-security';

type Context = { params: Promise<{ id: string }> };

const DEFAULT_QUESTION = '请总结当前课题情况，重点说明总体进展、任务完成度、周报要点、阻塞风险和下一步建议。';

function clip(value: string | null | undefined, max = 3000): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  await getProjectAccess(id, ctx);

  const parsed = projectSummarySchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  if (parsed.data.images.length > 0 && !ctx.isAdmin) {
    return NextResponse.json({ error: '只有实验室管理员可以在课题总结中调用 VLM 阅读图片资料' }, { status: 403 });
  }

  const hasImages = parsed.data.images.length > 0;
  const modelConfig = hasImages
    ? await getEffectiveVlmConfig(ctx.labId, ctx.userId, prisma)
    : await getEffectiveLlmConfig(ctx.labId, ctx.userId, prisma);
  if (!modelConfig) {
    return NextResponse.json({
      error: hasImages ? '尚未配置 VLM，无法阅读图片资料' : '尚未配置 LLM，无法生成课题总结',
      actionUrl: ctx.isAdmin ? '/admin/api-config' : '/user/api-config',
      actionText: `前往配置 ${hasImages ? 'VLM' : 'LLM'}`,
    }, { status: 400 });
  }

  const project = await prisma.researchProject.findUniqueOrThrow({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      tasks: {
        where: { deletedAt: null },
        include: {
          assignees: { include: { user: { select: { name: true } } } },
          updates: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 5 },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: 100,
      },
      weeklyReports: { include: { author: { select: { name: true } }, attachments: { select: { fileName: true, mimeType: true, fileSize: true, sha256: true } } }, orderBy: [{ weekStart: 'desc' }, { createdAt: 'desc' }], take: 16 },
      documents: {
        where: { deletedAt: null },
        include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'desc' },
        take: 16,
      },
      compounds: { include: { compound: { select: { name: true, commonName: true, casNumber: true, status: true } } }, take: 50 },
    },
  });

  const contextData = {
    project: {
      name: project.name,
      description: project.description,
      objective: project.objective,
      status: project.status,
      startDate: project.startDate,
      endDate: project.endDate,
      version: project.version,
    },
    members: project.members.map((member) => ({ name: member.user.name, role: member.role })),
    tasks: project.tasks.map((task) => ({
      name: task.name,
      description: clip(task.description, 700),
      status: task.status,
      progress: task.progress,
      estimatedWeeks: task.estimatedWeeks,
      tags: (() => { try { return JSON.parse(task.tags); } catch { return []; } })(),
      startDate: task.startDate,
      dueDate: task.dueDate,
      blockedReason: task.blockedReason,
      assignees: task.assignees.map((item) => item.user.name),
      latestUpdates: task.updates.map((update) => ({ author: update.author.name, note: clip(update.note, 600), progress: update.progress, status: update.status, createdAt: update.createdAt })),
    })),
    weeklyReports: project.weeklyReports.map((report) => ({
      weekStart: report.weekStart,
      author: report.author.name,
      title: report.title,
      content: clip(report.content, 1800),
      blockers: clip(report.blockers, 800),
      nextPlan: clip(report.nextPlan, 800),
      attachments: report.attachments,
    })),
    documents: project.documents.map((document) => ({
      title: document.title,
      type: document.docType,
      description: clip(document.description, 800),
      latestVersion: document.versions[0] ? {
        fileName: document.versions[0].fileName,
        status: document.versions[0].status,
        extractedText: clip(document.versions[0].extractedText, 2200),
        aiSummary: clip(document.versions[0].aiSummary, 1200),
      } : null,
    })),
    compounds: project.compounds.map((item) => item.compound),
  };

  const question = sanitizeUserInput(parsed.data.question || DEFAULT_QUESTION).text || DEFAULT_QUESTION;
  const contextJson = JSON.stringify(contextData);
  const exactContext = wrapContextAsData(contextJson.length > 60_000 ? `${contextJson.slice(0, 60_000)}\n[上下文已按长度上限截断]` : contextJson);
  const systemPrompt = `${getAssistantSystemPrompt('RESEARCH')}\n\n你正在生成指定课题的只读总结。只能依据下方课题上下文和管理员上传的图片，明确区分事实、推断与缺失信息，不得虚构实验结论。\n${exactContext}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; }
      };
      send({ stage: 'context', taskCount: project.tasks.length, reportCount: project.weeklyReports.length, documentCount: project.documents.length, usedVision: hasImages });
      try {
        const content = hasImages
          ? await streamVisionAnalysis({
              ...modelConfig,
              systemPrompt,
              question,
              images: parsed.data.images,
              onDelta: (delta) => send({ stage: 'delta', content: delta }),
            })
          : (await runAgentLoop({
              ...modelConfig,
              systemMessages: [{ role: 'system', content: systemPrompt }],
              conversationMessages: [{ role: 'user', content: question }],
              ctx: { labId: ctx.labId!, userId: ctx.userId, isAdmin: ctx.isAdmin },
              enableTools: false,
              maxRounds: 1,
              maxToolCalls: 0,
              onDelta: (delta) => send({ stage: 'delta', content: delta }),
            })).finalContent;

        const saved = await prisma.$transaction(async (tx) => {
          const summary = await tx.projectAiSummary.create({ data: { projectId: id, requestedById: ctx.userId, question, content, usedVision: hasImages } });
          await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'AI_SUMMARY', entityId: summary.id, action: 'CREATE', afterData: JSON.stringify({ question, usedVision: hasImages }), operatorId: ctx.userId } });
          return summary;
        });
        send({ stage: 'done', summaryId: saved.id, createdAt: saved.createdAt.toISOString(), usedVision: hasImages });
      } catch (error) {
        send({ stage: 'error', error: error instanceof Error ? error.message : '课题总结生成失败' });
      } finally {
        if (!closed) { closed = true; controller.close(); }
      }
    },
  });

  return new NextResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  });
});
