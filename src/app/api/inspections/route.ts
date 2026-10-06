import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { z } from 'zod';

const createInspectionSchema = z.object({
  assigneeId: z.string().min(1, '被派发人不能为空'),
  title: z.string().min(1, '标题不能为空').max(200),
  description: z.string().max(2000).optional(),
  dueDate: z.string().datetime({ message: '截止日期格式错误' }),
});

/**
 * GET /api/inspections
 * - 管理员：查询本实验室所有巡检任务
 * - 实验员：查询派发给自己的巡检任务
 * 支持 status 筛选
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  // 实验员只看自己的任务，管理员看本实验室全部
  if (authResult.role !== 'ADMIN') {
    where.assigneeId = authResult.userId;
  }
  // 按实验室隔离：必须有关联实验室
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }
  where.labId = authResult.labId;

  const inspections = await prisma.inspectionAssignment.findMany({
    where,
    include: {
      assignee: { select: { id: true, name: true } },
      assigner: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ data: inspections });
});

/**
 * POST /api/inspections
 * 管理员派发巡检任务
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const body = await request.json();
  const parsed = createInspectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  const { assigneeId, title, description, dueDate } = parsed.data;

  // 校验被派发人存在且为同实验室的实验员
  const assignee = await prisma.user.findFirst({
    where: { id: assigneeId, status: 'ACTIVE', labMemberships: { some: { labId: authResult.labId, status: 'ACTIVE' } } },
  });
  if (!assignee) {
    return NextResponse.json({ error: '被派发人不存在' }, { status: 404 });
  }
  const inspection = await prisma.inspectionAssignment.create({
    data: {
      labId: authResult.labId || '',
      assigneeId,
      assignerId: authResult.userId,
      title,
      description: description || null,
      dueDate: new Date(dueDate),
      status: 'ASSIGNED',
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
    targetId: inspection.id,
    targetName: title,
    afterData: { assigneeId, title, dueDate, status: 'ASSIGNED' },
    note: `派发巡检任务「${title}」给${assignee.name}`,
  });

  return NextResponse.json({ data: inspection, message: '巡检任务已派发' });
});
