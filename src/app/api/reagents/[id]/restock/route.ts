import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, apiError } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { RESTOCK_FEATURE_ENABLED } from '@/lib/features';

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
 * 补货入库 — 管理员专用
 * 增加试剂库存，并创建入库台账记录
 */
export const POST = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!RESTOCK_FEATURE_ENABLED) {
    return apiError('补货功能正在重新设计，当前版本暂不可用', 503);
  }

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
  const { quantity, note } = body ?? {};

  if (!quantity || typeof quantity !== 'number' || quantity <= 0) {
    return apiError('补货数量必须为正数', 400);
  }

  const reagent = await prisma.reagent.findUnique({ where: { id } });
  if (!reagent) {
    return apiError('试剂不存在', 404);
  }

  return prisma.$transaction(async (tx) => {
    const newStock = reagent.stockQuantity + quantity;

    const updated = await tx.reagent.update({
      where: { id },
      data: { stockQuantity: newStock },
    });

    await tx.reagentLog.create({
      data: {
        reagentId: id,
        action: 'STOCK_IN',
        quantity,
        operatorId: authResult.userId,
        note: note || `采购补货 ${quantity}${reagent.unit ?? ''}`,
      },
    });

    // 如果原先有低库存风险事件且现在库存充足，自动解决
    if (reagent.stockQuantity <= reagent.minStock && newStock > reagent.minStock) {
      await tx.riskEvent.updateMany({
        where: {
          reagentId: id,
          type: 'STOCK_LOW',
          isResolved: false,
        },
        data: {
          isResolved: true,
          resolvedAt: new Date(),
          resolvedById: authResult.userId,
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: '补货成功',
      reagent: updated,
    });
  });
});
