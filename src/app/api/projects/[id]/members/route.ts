import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { projectMembersSchema } from '@/lib/validations/project';
import { getProjectAccess } from '@/lib/research/projects';

type Context = { params: Promise<{ id: string }> };

export const PUT = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAdmin(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  const access = await getProjectAccess(id, ctx);
  const parsed = projectMembersSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);

  const managerIds = [...new Set(parsed.data.managerIds)];
  const memberIds = [...new Set(parsed.data.memberIds)].filter((userId) => !managerIds.includes(userId));
  if (managerIds.length < 1 || managerIds.length > 3) {
    return NextResponse.json({ error: '每个课题必须指定 1～3 名实验员课题管理员' }, { status: 400 });
  }
  const selected = await prisma.user.findMany({ where: { id: { in: [...managerIds, ...memberIds] }, labId: ctx.labId }, select: { id: true, role: true } });
  if (selected.length !== managerIds.length + memberIds.length || managerIds.some((userId) => selected.find((user) => user.id === userId)?.role !== 'MEMBER')) {
    return NextResponse.json({ error: '成员必须属于当前实验室，课题管理员必须是实验员' }, { status: 400 });
  }

  const before = access.project.members.map((member) => ({ userId: member.userId, role: member.role }));
  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({ where: { projectId: id } });
    if (managerIds.length + memberIds.length > 0) {
      await tx.projectMember.createMany({
        data: [
          ...managerIds.map((userId) => ({ projectId: id, userId, role: 'MANAGER', addedById: ctx.userId })),
          ...memberIds.map((userId) => ({ projectId: id, userId, role: 'MEMBER', addedById: ctx.userId })),
        ],
      });
    }
    await tx.researchProject.update({ where: { id }, data: { version: { increment: 1 } } });
    await tx.projectChangeLog.create({
      data: {
        projectId: id,
        entityType: 'MEMBER',
        entityId: id,
        action: 'UPDATE',
        beforeData: JSON.stringify(before),
        afterData: JSON.stringify({ managerIds, memberIds }),
        operatorId: ctx.userId,
      },
    });
  });
  return NextResponse.json({ data: { managerIds, memberIds } });
});
