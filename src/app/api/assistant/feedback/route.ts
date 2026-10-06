import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { safeTrace, traceJson } from '@/lib/agent/trace';
import { problemCode } from '@/lib/agent/diagnostics';
const schema = z.object({ runId: z.string().min(1).max(100), rating: z.enum(['useful','not_useful']).default('not_useful'), category: z.enum(['WRONG_ANSWER','MISSING_CONTEXT','TOOL_ERROR','SLOW','OTHER']).default('OTHER'), note: z.string().trim().max(2000).default(''), shareDiagnostics: z.boolean().default(false) });
export const POST = withErrorHandler(async (request: NextRequest) => {
 const auth = await requireAuth(request); if (!isUserContext(auth)) return auth;
 const parsed = schema.safeParse(await request.json()); if (!parsed.success) return NextResponse.json({ error: '反馈格式不正确' }, { status: 400 });
 const { runId, rating, category, note, shareDiagnostics } = parsed.data;
 const run = await prisma.assistantRun.findFirst({ where: { id: runId, userId: auth.userId, labId: auth.labId ?? '', message: { session: { deletedAt: null } } }, include: { message: true } });
 if (!run) return NextResponse.json({ error: '运行不存在或无权访问' }, { status: 404 });
 const safeNote = String(safeTrace(note));
 const result = await prisma.$transaction(async tx => {
  await tx.chatMessage.update({ where: { id: run.messageId }, data: { feedback: rating, feedbackNote: safeNote } });
  // Explicit sharing adds only the visible answer and immediately preceding question;
  // it never invents historical tool/context snapshots that were not captured.
  let sharedSnapshot: string | undefined;
  if (shareDiagnostics && !run.captureContent && !run.purgedAt) {
   const question = await tx.chatMessage.findFirst({ where: { sessionId: run.message.sessionId, role: 'user', createdAt: { lte: run.message.createdAt } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
   sharedSnapshot = traceJson({ question: question?.content ?? '', scope: 'Shared visible question/answer only; tool inputs were not captured' });
  }
  await tx.assistantRun.update({ where: { id: runId }, data: { shared: shareDiagnostics, ...(sharedSnapshot ? { input: sharedSnapshot, output: traceJson(run.message.content) } : {}) } });
  if (rating === 'useful') return null;
  return tx.assistantCase.upsert({ where: { runId }, create: { runId, category, note: safeNote }, update: { category, note: safeNote } });
 });
 return NextResponse.json({ caseId: result?.id ?? null, runId, problemCode: problemCode(runId), rating }, { headers: { 'Cache-Control': 'no-store' } });
});
