import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { listMyTodos } from '@/lib/services/todo.service';
import { z } from 'zod';

const createTodoSchema = z.object({
  assigneeId: z.string().min(1, '接收人不能为空'),
  title: z.string().min(1, '标题不能为空').max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional(),
});

/**
 * GET /api/todos
 * - 实验员：查询派给自己的待办（含系统派生 + 管理员派发）
 * - 管理员：?all=1 查询本实验室全部待办；默认查询自己被指派的待办
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const viewAll = searchParams.get('all') === '1' && authResult.isAdmin;

  if (viewAll) {
    // 管理员查看实验室全部待办
    const data = await prisma.todo.findMany({
      where: { labId: authResult.labId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        assignee: { select: { id: true, name: true } },
        assigner: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ data });
  }

  // 默认：查询自己的待办（含派生）
  const data = await listMyTodos(authResult.userId, authResult.labId);
  return NextResponse.json({ data });
});

/**
 * POST /api/todos
 * 管理员派发"其他事项"待办给指定实验员
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createTodoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  const { assigneeId, title, description, dueDate } = parsed.data;

  // 校验接收人存在且同实验室
  const assignee = await prisma.user.findUnique({ where: { id: assigneeId } });
  if (!assignee) {
    return NextResponse.json({ error: '接收人不存在' }, { status: 404 });
  }
  if (assignee.labId !== authResult.labId) {
    return NextResponse.json({ error: '只能派发给本实验室成员' }, { status: 403 });
  }

  const todo = await prisma.todo.create({
    data: {
      labId: authResult.labId,
      assigneeId,
      assignerId: authResult.userId,
      type: 'OTHER',
      title,
      description: description || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      status: 'PENDING',
    },
    include: {
      assignee: { select: { id: true, name: true } },
      assigner: { select: { id: true, name: true } },
    },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'CREATE',
    targetType: 'INSPECTION',
    targetId: todo.id,
    targetName: title,
    afterData: { assigneeId, title, type: 'OTHER' },
    note: `派发任务「${title}」给${assignee.name}`,
    labId: authResult.labId,
  });

  return NextResponse.json({ data: todo, message: '任务已派发' });
});
