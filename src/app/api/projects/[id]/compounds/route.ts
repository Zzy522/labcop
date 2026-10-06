import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { getProjectAccess, assertCanManage } from '@/lib/research/projects';
import { projectCompoundSchema } from '@/lib/validations/project';

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  const access = await getProjectAccess(id, ctx);
  assertCanManage(access.role);
  const parsed = projectCompoundSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const compound = await prisma.compound.findFirst({ where: { id: parsed.data.compoundId, labId: ctx.labId } });
  if (!compound) return NextResponse.json({ error: '化合物不存在' }, { status: 404 });
  const link = await prisma.$transaction(async (tx) => {
    const result = await tx.projectCompound.upsert({ where: { projectId_compoundId: { projectId: id, compoundId: compound.id } }, update: { role: parsed.data.role || null }, create: { projectId: id, compoundId: compound.id, role: parsed.data.role || null, addedById: ctx.userId } });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'COMPOUND', entityId: compound.id, action: 'CREATE', afterData: JSON.stringify(result), operatorId: ctx.userId } });
    return result;
  });
  return NextResponse.json({ data: link }, { status: 201 });
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  const access = await getProjectAccess(id, ctx);
  assertCanManage(access.role);
  const compoundId = new URL(request.url).searchParams.get('compoundId');
  if (!compoundId) return NextResponse.json({ error: '缺少 compoundId' }, { status: 400 });
  const current = await prisma.projectCompound.findUnique({ where: { projectId_compoundId: { projectId: id, compoundId } } });
  if (!current) return NextResponse.json({ error: '课题未关联该化合物' }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.projectCompound.delete({ where: { projectId_compoundId: { projectId: id, compoundId } } });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'COMPOUND', entityId: compoundId, action: 'DELETE', beforeData: JSON.stringify(current), operatorId: ctx.userId } });
  });
  return NextResponse.json({ success: true });
});

