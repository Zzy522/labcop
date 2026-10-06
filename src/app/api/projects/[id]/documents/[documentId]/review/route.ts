import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { getProjectAccess, assertCanManage } from '@/lib/research/projects';
import { reviewSchema } from '@/lib/validations/project';

type Context = { params: Promise<{ id: string; documentId: string }> };

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id, documentId } = await context.params;
  const access = await getProjectAccess(id, ctx);
  assertCanManage(access.role);
  const parsed = reviewSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const version = await prisma.projectDocumentVersion.findFirst({ where: { id: documentId, document: { projectId: id, deletedAt: null } } });
  if (!version) return NextResponse.json({ error: '文档版本不存在' }, { status: 404 });
  if (version.status !== 'PENDING_REVIEW') return NextResponse.json({ error: '该文档版本已处理' }, { status: 409 });
  const status = parsed.data.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.projectDocumentVersion.update({ where: { id: version.id }, data: { status } });
    await tx.projectDocumentReview.create({ data: { versionId: version.id, reviewerId: ctx.userId, decision: parsed.data.decision, comment: parsed.data.comment || null } });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'DOCUMENT_VERSION', entityId: version.id, action: parsed.data.decision === 'APPROVED' ? 'APPROVE' : 'REJECT', beforeData: JSON.stringify(version), afterData: JSON.stringify(result), operatorId: ctx.userId, reason: parsed.data.comment || null } });
    return result;
  });
  return NextResponse.json({ data: updated });
});

