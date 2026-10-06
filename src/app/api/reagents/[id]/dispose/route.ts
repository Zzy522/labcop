import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, apiError } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 校验试剂是否属于当前用户的实验室
 */
async function checkReagentOwnership(reagentId: string, labId?: string): Promise<boolean> {
  if (!labId) return false;
  const reagent = await prisma.reagent.findUnique({
    where: { id: reagentId },
    select: { labId: true },
  });
  return !!reagent && reagent.labId === labId;
}

/**
 * 处置过期试剂 — 管理员专用
 * 将试剂库存归零，并创建处置记录
 */
export const POST = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return apiError('未关联实验室', 403);
  }

  const { id } = await params;

  // IDOR 修复：校验试剂归属
  const owned = await checkReagentOwnership(id, authResult.labId);
  if (!owned) {
    return apiError('试剂不存在或无权访问', 404);
  }

  const body = await request.json().catch(() => ({}));
  const { reason } = body ?? {};

  const reagent = await prisma.reagent.findUnique({ where: { id } });
  if (!reagent) {
    return apiError('试剂不存在', 404);
  }

  if (reagent.stockQuantity <= 0) {
    return apiError('该试剂库存为零，无需处置', 400);
  }

  return prisma.$transaction(async (tx) => {
    const current = await tx.reagent.findFirst({ where: { id, labId: authResult.labId, archivedAt: null } });
    if (!current || current.stockQuantity <= 0) return apiError('库存已变化，请刷新', 409);
    const previousStock = current.stockQuantity;

    // 库存归零
    await tx.reagent.update({
      where: { id, version: current.version },
      data: { stockQuantity: 0, version: { increment: 1 } },
    });

    // 创建台账记录
    await tx.reagentLog.create({
      data: {
        reagentId: id,
        action: 'STOCK_OUT',
        quantity: previousStock,
        operatorId: authResult.userId,
        note: `过期处置${reason ? `：${reason}` : ''}`,
      },
    });

    // 创建/更新风险事件
    await tx.riskEvent.create({
      data: {
        type: 'EXPIRED',
        level: 'INFO',
        description: `试剂「${reagent.name}」已处置（${previousStock}${reagent.unit ?? ''}）${reason ? `，原因：${reason}` : ''}`,
        reagentId: id,
        isResolved: true,
        resolvedAt: new Date(),
        resolvedById: authResult.userId,
        labId: authResult.labId,
      },
    });

    return NextResponse.json({
      success: true,
      message: '试剂已处置',
      previousStock,
    });
  });
});
