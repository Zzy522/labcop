import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { getProjectAccess } from '@/lib/research/projects';
import { taskChangeRequestSchema } from '@/lib/validations/project';

type Context = { params: Promise<{ id: string; taskId: string }> };

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id, taskId } = await context.params;
  await getProjectAccess(id, ctx);
  const parsed = taskChangeRequestSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const input = parsed.data;
  const task = await prisma.projectPhaseTask.findFirst({ where: { id: taskId, projectId: id, deletedAt: null } });
  if (!task) return NextResponse.json({ error: '阶段任务不存在' }, { status: 404 });
  if (task.version !== input.baseVersion) return NextResponse.json({ error: '阶段任务已更新，请刷新后重新申请' }, { status: 409 });
  const duplicate = await prisma.projectTaskChangeRequest.findFirst({ where: { taskId, requesterId: ctx.userId, status: 'PENDING' } });
  if (duplicate) return NextResponse.json({ error: '您已有一条待审批的修改申请' }, { status: 409 });

  const { baseVersion, reason, ...patch } = input;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '请至少修改一个任务字段' }, { status: 400 });
  const created = await prisma.$transaction(async (tx) => {
    const requestItem = await tx.projectTaskChangeRequest.create({ data: { projectId: id, taskId, requesterId: ctx.userId, baseVersion, patchData: JSON.stringify(patch), reason } });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'TASK_REQUEST', entityId: requestItem.id, action: 'SUBMIT', beforeData: JSON.stringify(task), afterData: JSON.stringify(patch), operatorId: ctx.userId, requestId: requestItem.id, reason } });
    return requestItem;
  });
  return NextResponse.json({ data: { ...created, patchData: patch } }, { status: 201 });
});

