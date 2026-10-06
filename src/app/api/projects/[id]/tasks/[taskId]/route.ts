import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { getProjectAccess, assertCanManage, publicTask } from '@/lib/research/projects';
import { taskUpdateSchema } from '@/lib/validations/project';
import { normalizeWeekStart, taskDueDate } from '@/lib/research/schedule';

type Context = { params: Promise<{ id: string; taskId: string }> };

export const PATCH = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id, taskId } = await context.params;
  const access = await getProjectAccess(id, ctx);
  assertCanManage(access.role);
  const parsed = taskUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const input = parsed.data;
  const current = await prisma.projectPhaseTask.findFirst({ where: { id: taskId, projectId: id, deletedAt: null }, include: { assignees: true } });
  if (!current) return NextResponse.json({ error: '阶段任务不存在' }, { status: 404 });
  if (current.version !== input.version) return NextResponse.json({ error: '阶段任务已被修改，请刷新后重试' }, { status: 409 });

  const effectiveStart = input.startDate === undefined ? current.startDate : normalizeWeekStart(input.startDate);
  const effectiveWeeks = input.estimatedWeeks ?? current.estimatedWeeks;
  const scheduleChanged = input.startDate !== undefined || input.estimatedWeeks !== undefined;

  const assigneeIds = input.assigneeIds;
  if (assigneeIds) {
    const memberIds = new Set(access.project.members.map((member) => member.userId));
    if (assigneeIds.some((userId) => !memberIds.has(userId))) return NextResponse.json({ error: '任务只能分配给当前课题成员' }, { status: 400 });
    if (input.leadAssigneeId && !assigneeIds.includes(input.leadAssigneeId)) return NextResponse.json({ error: '主负责人必须同时是任务执行人' }, { status: 400 });
  }
  const updated = await prisma.$transaction(async (tx) => {
    if (assigneeIds) {
      await tx.projectTaskAssignee.deleteMany({ where: { taskId } });
      if (assigneeIds.length) await tx.projectTaskAssignee.createMany({ data: assigneeIds.map((userId) => ({ taskId, userId, isLead: userId === input.leadAssigneeId })) });
    }
    const result = await tx.projectPhaseTask.update({
      where: { id: taskId, version: input.version },
      data: {
        parentId: input.parentId,
        name: input.name,
        description: input.description,
        startDate: input.startDate === undefined ? undefined : effectiveStart,
        dueDate: scheduleChanged ? taskDueDate(effectiveStart, effectiveWeeks) : undefined,
        estimatedWeeks: input.estimatedWeeks,
        status: input.status,
        priority: input.priority,
        progress: input.status === 'COMPLETED' ? 100 : input.progress,
        tags: input.tags === undefined ? undefined : JSON.stringify(input.tags),
        completedAt: input.status === 'COMPLETED' ? new Date() : input.status ? null : undefined,
        blockedReason: input.blockedReason,
        updatedById: ctx.userId,
        version: { increment: 1 },
      },
      include: { assignees: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    if (input.stageNote || input.progress !== undefined || input.status !== undefined || input.tags !== undefined) {
      await tx.projectTaskUpdate.create({
        data: {
          taskId,
          authorId: ctx.userId,
          note: input.stageNote || '更新任务状态、标签或完成度',
          progress: result.progress,
          status: result.status,
          tags: result.tags,
        },
      });
    }
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'TASK', entityId: taskId, action: 'UPDATE', beforeData: JSON.stringify(current), afterData: JSON.stringify(result), operatorId: ctx.userId } });
    return result;
  });
  return NextResponse.json({ data: publicTask(updated) });
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id, taskId } = await context.params;
  await getProjectAccess(id, ctx);
  if (!ctx.isAdmin) return NextResponse.json({ error: '只有实验室管理员可以删除阶段任务' }, { status: 403 });
  const current = await prisma.projectPhaseTask.findFirst({ where: { id: taskId, projectId: id, deletedAt: null } });
  if (!current) return NextResponse.json({ error: '阶段任务不存在' }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    const result = await tx.projectPhaseTask.update({ where: { id: taskId }, data: { deletedAt: new Date(), updatedById: ctx.userId, version: { increment: 1 } } });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'TASK', entityId: taskId, action: 'DELETE', beforeData: JSON.stringify(current), afterData: JSON.stringify(result), operatorId: ctx.userId } });
  });
  return NextResponse.json({ success: true });
});
