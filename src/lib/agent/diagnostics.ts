import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { platformAuditData } from '@/lib/platform-audit';
import { safeTrace } from './trace';

export const problemCode = (id: string) => `LC-${id}`;
export function parseProblemCode(value: string) { return value.trim().replace(/^LC-/i, ''); }
export async function diagnosticAccess(request: NextRequest, permission: 'read' | 'content' | 'export' = 'read') {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const grant = await prisma.assistantDiagnosticGrant.findUnique({ where: { userId: auth.userId } });
  if (!grant || (permission === 'content' && !grant.canReadContent) || (permission === 'export' && (!grant.canExport || !grant.canReadContent))) return NextResponse.json({ error: '未授予所需诊断权限，请在诊断设置中联系平台负责人配置' }, { status: 403 });
  const labs: string[] = JSON.parse(grant.labIds);
  return { auth, grant, scope: (labs.length ? { labId: { in: labs } } : {}) as Prisma.AssistantRunWhereInput };
}
export function activeRuns(scope: Prisma.AssistantRunWhereInput): Prisma.AssistantRunWhereInput {
  return { AND: [scope, { message: { session: { deletedAt: null } } }] };
}
export function contentAvailable(run: { captureContent: boolean; shared: boolean; purgedAt: Date | null; expiresAt: Date | null }) {
  return (run.captureContent || run.shared) && !run.purgedAt && (!run.expiresAt || run.expiresAt > new Date());
}
export async function capturePolicy(labId: string) {
  try {
    const policy = await prisma.assistantDiagnosticPolicy.findUnique({ where: { labId } });
    return { captureContent: !!(policy?.enabled && policy.expiresAt && policy.expiresAt > new Date()), retentionDays: policy?.retentionDays ?? 30 };
  } catch { return { captureContent: false, retentionDays: 30 }; }
}
export async function diagnosticAudit(userId: string, action: string, targetId: string) {
  await prisma.platformAuditLog.create({ data: platformAuditData({ operatorId: userId, action, targetType: 'AssistantRun', targetId }) });
}
export async function getDiagnosticRun(request: NextRequest, rawId: string) {
  const download = request.nextUrl.searchParams.has('download');
  const access = await diagnosticAccess(request, download ? 'export' : 'read');
  if (access instanceof NextResponse) return access;
  const id = parseProblemCode(rawId);
  const run = await prisma.assistantRun.findFirst({ where: { AND: [activeRuns(access.scope), { OR: [{ id }, { badCase: { id } }] }] }, include: { spans: { orderBy: { sequence: 'asc' } }, message: { select: { sessionId: true, feedback: true } }, badCase: { include: { evaluations: { orderBy: { createdAt: 'desc' }, take: 20 } } } } });
  if (!run) return NextResponse.json({ error: '问题编号不存在、会话已删除或超出授权范围' }, { status: 404 });
  const readable = access.grant.canReadContent && contentAvailable(run);
  const data = { ...run, input: readable ? run.input : '{}', output: readable ? run.output : '', error: readable ? run.error : (run.error ? '阶段失败，正文不可访问' : null), spans: run.spans.map(s => ({ ...s, input: readable ? s.input : '{}', output: readable ? s.output : null, error: readable ? s.error : (s.error ? '阶段失败' : null) })), badCase: run.badCase ? { ...run.badCase, owner: access.grant.canReadContent ? run.badCase.owner : '', rootCause: readable ? run.badCase.rootCause : '', note: access.grant.canReadContent && !run.purgedAt && (!run.expiresAt || run.expiresAt > new Date()) ? run.badCase.note : '', expected: readable ? run.badCase.expected : '', assertions: readable ? run.badCase.assertions : '{}', evaluations: readable ? run.badCase.evaluations : [] } : null };
  await diagnosticAudit(access.auth.userId, download ? 'ASSISTANT_TRACE_EXPORT' : 'ASSISTANT_TRACE_READ', run.id);
  return NextResponse.json({ schemaVersion: 2, ...JSON.parse(JSON.stringify(data, (_key, value) => { if (typeof value !== 'string') return value; const sanitized = safeTrace(value); return typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized); })), problemCode: problemCode(run.id), sessionId: run.message.sessionId, contentAvailable: readable, canExport: access.grant.canExport && access.grant.canReadContent, interrupted: run.status === 'RUNNING' && Date.now() - run.createdAt.getTime() > 15 * 60000 }, { headers: { 'Cache-Control': 'no-store', ...(download ? { 'Content-Disposition': `attachment; filename="trace-${run.id}.json"` } : {}) } });
}
