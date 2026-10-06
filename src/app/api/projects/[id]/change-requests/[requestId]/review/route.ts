import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { getProjectAccess, assertCanManage, publicTask } from '@/lib/research/projects';
import { reviewSchema, taskUpdateSchema } from '@/lib/validations/project';
import { normalizeWeekStart, taskDueDate } from '@/lib/research/schedule';

type Context = { params: Promise<{ id: string; requestId: string }> };

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id, requestId } = await context.params;
  const access = await getProjectAccess(id, ctx);
  assertCanManage(access.role);
  const parsed = reviewSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const requestItem = await prisma.projectTaskChangeRequest.findFirst({ where: { id: requestId, projectId: id }, include: { task: { include: { assignees: true } } } });
  if (!requestItem) return NextResponse.json({ error: '修改申请不存在' }, { status: 404 });
  if (requestItem.status !== 'PENDING') return NextResponse.json({ error: '该申请已经处理' }, { status: 409 });

  if (parsed.data.decision === 'REJECTED') {
    const rejected = await prisma.$transaction(async (tx) => {
      const result = await tx.projectTaskChangeRequest.update({ where: { id: requestId }, data: { status: 'REJECTED', reviewerId: ctx.userId, reviewedAt: new Date(), reviewComment: parsed.data.comment || null } });
      await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'TASK_REQUEST', entityId: requestId, action: 'REJECT', operatorId: ctx.userId, requestId, reason: parsed.data.comment || null } });
      return result;
    });
    return NextResponse.json({ data: rejected });
  }

  if (requestItem.task.version !== requestItem.baseVersion) {
    await prisma.$transaction(async (tx) => {
      await tx.projectTaskChangeRequest.update({ where: { id: requestId }, data: { status: 'CONFLICT', reviewerId: ctx.userId, reviewedAt: new Date(), reviewComment: '阶段任务版本已变化，请基于最新版本重新提交' } });
      await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'TASK_REQUEST', entityId: requestId, action: 'REJECT', operatorId: ctx.userId, requestId, reason: '版本冲突' } });
    });
    return NextResponse.json({ error: '阶段任务版本已变化，申请已标记为冲突' }, { status: 409 });
  }

  const rawPatch = JSON.parse(requestItem.patchData) as Record<string, unknown>;
  const patchResult = taskUpdateSchema.safeParse({ ...rawPatch, version: requestItem.baseVersion });
  if (!patchResult.success) return NextResponse.json({ error: '申请中的修改内容已不符合当前规则' }, { status: 400 });
  const patch = patchResult.data;
  const effectiveStart = patch.startDate === undefined ? requestItem.task.startDate : normalizeWeekStart(patch.startDate);
  const effectiveWeeks = patch.estimatedWeeks ?? requestItem.task.estimatedWeeks;
  const scheduleChanged = patch.startDate !== undefined || patch.estimatedWeeks !== undefined;
  const assigneeIds = patch.assigneeIds;
  if (assigneeIds) {
    const memberIds = new Set(access.project.members.map((member) => member.userId));
    if (assigneeIds.some((userId) => !memberIds.has(userId))) return NextResponse.json({ error: '申请包含已离开课题的任务成员' }, { status: 409 });
    if (patch.leadAssigneeId && !assigneeIds.includes(patch.leadAssigneeId)) return NextResponse.json({ error: '申请中的主负责人不是任务执行人' }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (assigneeIds) {
      await tx.projectTaskAssignee.deleteMany({ where: { taskId: requestItem.taskId } });
      if (assigneeIds.length) await tx.projectTaskAssignee.createMany({ data: assigneeIds.map((userId) => ({ taskId: requestItem.taskId, userId, isLead: userId === patch.leadAssigneeId })) });
    }
    const task = await tx.projectPhaseTask.update({
      where: { id: requestItem.taskId, version: requestItem.baseVersion },
      data: {
        parentId: patch.parentId,
        name: patch.name,
        description: patch.description,
        startDate: patch.startDate === undefined ? undefined : effectiveStart,
        dueDate: scheduleChanged ? taskDueDate(effectiveStart, effectiveWeeks) : undefined,
        estimatedWeeks: patch.estimatedWeeks,
        status: patch.status,
        priority: patch.priority,
        progress: patch.status === 'COMPLETED' ? 100 : patch.progress,
        tags: patch.tags === undefined ? undefined : JSON.stringify(patch.tags),
        completedAt: patch.status === 'COMPLETED' ? new Date() : patch.status ? null : undefined,
        blockedReason: patch.blockedReason,
        updatedById: ctx.userId,
        version: { increment: 1 },
      },
      include: { assignees: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    if (patch.stageNote || patch.progress !== undefined || patch.status !== undefined || patch.tags !== undefined) {
      await tx.projectTaskUpdate.create({
        data: {
          taskId: task.id,
          authorId: requestItem.requesterId,
          note: patch.stageNote || '通过修改申请更新任务状态、标签或完成度',
          progress: task.progress,
          status: task.status,
          tags: task.tags,
        },
      });
    }
    await tx.projectTaskChangeRequest.update({ where: { id: requestId }, data: { status: 'APPROVED', reviewerId: ctx.userId, reviewedAt: new Date(), reviewComment: parsed.data.comment || null } });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'TASK', entityId: task.id, action: 'UPDATE', beforeData: JSON.stringify(requestItem.task), afterData: JSON.stringify(task), source: 'APPROVED_REQUEST', requestId, operatorId: ctx.userId, reason: parsed.data.comment || requestItem.reason } });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'TASK_REQUEST', entityId: requestId, action: 'APPROVE', operatorId: ctx.userId, requestId, reason: parsed.data.comment || null } });
    return task;
  });
  return NextResponse.json({ data: publicTask(updated) });
});
