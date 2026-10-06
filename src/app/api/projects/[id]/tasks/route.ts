import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { getProjectAccess, assertCanManage, publicTask } from '@/lib/research/projects';
import { taskCreateSchema } from '@/lib/validations/project';
import { normalizeWeekStart, taskDueDate } from '@/lib/research/schedule';

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  const access = await getProjectAccess(id, ctx);
  assertCanManage(access.role);
  const parsed = taskCreateSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const input = parsed.data;

  const startDate = normalizeWeekStart(input.startDate);

  const memberIds = new Set(access.project.members.map((member) => member.userId));
  if (input.assigneeIds.some((userId) => !memberIds.has(userId))) return NextResponse.json({ error: '任务只能分配给当前课题成员' }, { status: 400 });
  if (input.leadAssigneeId && !input.assigneeIds.includes(input.leadAssigneeId)) return NextResponse.json({ error: '主要负责人必须同时是任务成员' }, { status: 400 });

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.projectPhaseTask.create({
      data: {
        projectId: id,
        parentId: input.parentId || null,
        name: input.name,
        description: input.description || null,
        startDate,
        dueDate: taskDueDate(startDate, input.estimatedWeeks),
        estimatedWeeks: input.estimatedWeeks,
        status: input.status,
        priority: input.priority,
        progress: input.status === 'COMPLETED' ? 100 : input.progress,
        tags: JSON.stringify(input.tags),
        completedAt: input.status === 'COMPLETED' ? new Date() : null,
        blockedReason: input.blockedReason || null,
        createdById: ctx.userId,
        updatedById: ctx.userId,
        assignees: { create: input.assigneeIds.map((userId) => ({ userId, isLead: userId === input.leadAssigneeId })) },
      },
      include: { assignees: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    if (input.stageNote) {
      await tx.projectTaskUpdate.create({
        data: {
          taskId: created.id,
          authorId: ctx.userId,
          note: input.stageNote,
          progress: created.progress,
          status: created.status,
          tags: created.tags,
        },
      });
    }
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'TASK', entityId: created.id, action: 'CREATE', afterData: JSON.stringify(created), operatorId: ctx.userId } });
    return created;
  });
  return NextResponse.json({ data: publicTask(task) }, { status: 201 });
});
