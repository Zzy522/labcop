import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { activeRuns, diagnosticAccess } from '@/lib/agent/diagnostics';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { platformAuditData } from '@/lib/platform-audit';
import { assertionSchema, candidateSchema, evaluateRegression } from '@/lib/agent/regression';
import { traceJson, safeTrace } from '@/lib/agent/trace';

const updateSchema = z.object({ owner: z.string().trim().max(100).default(''), rootCause: z.string().trim().max(2000).default(''), expected: z.string().trim().min(1).max(10000), assertions: assertionSchema, status: z.enum(['TRIAGED', 'READY', 'CLOSED']) });
type Context = { params: Promise<{ id: string }> };
export const PATCH = withErrorHandler(async (request: NextRequest, { params }: Context) => {
  const access = await diagnosticAccess(request, 'content');
  if (access instanceof NextResponse) return access;
  const auth = access.auth;
  const { id } = await params;
  const body = updateSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: '请填写预期行为及有效的断言 JSON' }, { status: 400 });
  const existing = await prisma.assistantCase.findFirst({ where: { id, run: { AND: [activeRuns(access.scope), { purgedAt: null, expiresAt: { gt: new Date() } }] } } });
  if (!existing) return NextResponse.json({ error: '案例不存在' }, { status: 404 });
  await prisma.$transaction([
    prisma.assistantCase.update({ where: { id }, data: { ...body.data, owner: String(safeTrace(body.data.owner)), rootCause: String(safeTrace(body.data.rootCause)), expected: String(safeTrace(body.data.expected)), assertions: traceJson(body.data.assertions) } }),
    prisma.platformAuditLog.create({ data: platformAuditData({ operatorId: auth.userId, action: 'ASSISTANT_CASE_UPDATE', targetType: 'AssistantCase', targetId: id, after: { status: body.data.status } }) }),
  ]);
  return NextResponse.json({ ok: true });
});

// Evaluate a newly produced candidate, never silently label the old bad answer as a successful replay.
export const POST = withErrorHandler(async (request: NextRequest, { params }: Context) => {
  const access = await diagnosticAccess(request, 'content');
  if (access instanceof NextResponse) return access;
  const auth = access.auth;
  const { id } = await params;
  const body = candidateSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: '候选结果需包含 release、output、tools、durationMs、status' }, { status: 400 });
  const badCase = await prisma.assistantCase.findFirst({ where: { id, run: { AND: [activeRuns(access.scope), { purgedAt: null, expiresAt: { gt: new Date() } }] } } });
  if (!badCase || !badCase.expected) return NextResponse.json({ error: '请先完善案例的预期行为' }, { status: 400 });
  const assertions = assertionSchema.parse(JSON.parse(badCase.assertions));
  const result = evaluateRegression(assertions, body.data);
  const evaluation = await prisma.assistantEvaluation.create({ data: { caseId: id, operatorId: auth.userId, candidate: traceJson(body.data), result: JSON.stringify({ ...result, assertions, expected: badCase.expected, source: 'MANUAL_CANDIDATE' }) } });
  return NextResponse.json({ id: evaluation.id, ...result }, { headers: { 'Cache-Control': 'no-store' } });
});
