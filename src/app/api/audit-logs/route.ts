import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/audit-logs
 * 查询审计日志（仅管理员）
 * 支持筛选：targetType, action, operatorId, targetId
 * 支持分页：page, pageSize
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  const authResult = await requireAdmin(req);
  if (!isUserContext(authResult)) return authResult;

  // 数据隔离：必须有 labId
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室，无法查询审计日志' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const targetType = searchParams.get('targetType') ?? undefined;
  const action = searchParams.get('action') ?? undefined;
  const operatorId = searchParams.get('operatorId') ?? undefined;
  const targetId = searchParams.get('targetId') ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));

  // 数据隔离：按 labId 过滤（兼容历史 labId=null 数据）
  const where: Record<string, unknown> = {
    labId: authResult.labId,
  };
  if (targetType) where.targetType = targetType;
  if (action) where.action = action;
  if (operatorId) where.operatorId = operatorId;
  if (targetId) where.targetId = targetId;

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { operator: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({
    data: items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});
