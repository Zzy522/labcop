import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, NotFoundError } from '@/lib/api-utils';
import { AppError, ErrorCategory } from '@/lib/errors';
import { idempotentTransaction, requestDigest, requireIdempotencyKey } from '@/lib/idempotency';
import { logAudit } from '@/lib/services/audit.service';

const schema = z.object({ quantity: z.number().finite().nonnegative(), version: z.number().int().nonnegative(), reason: z.string().trim().min(4).max(500) }).strict();

export const POST = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAdmin(request);
  if (!isUserContext(auth)) return auth;
  if (!auth.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请填写有效盘点数量、版本和至少四字的原因' }, { status: 400 });
  const { id } = await params;
  const input = parsed.data;
  const data = await idempotentTransaction({ labId: auth.labId, userId: auth.userId, operation: 'STOCK_ADJUST', key: requireIdempotencyKey(request), digest: requestDigest({ id, ...input }) }, async tx => {
    const before = await tx.reagent.findFirst({ where: { id, labId: auth.labId, archivedAt: null } });
    if (!before) throw new NotFoundError('试剂');
    const delta = input.quantity - before.stockQuantity;
    if (!delta) throw new AppError(ErrorCategory.BUSINESS_CONFLICT, '库存没有变化');
    const changed = await tx.reagent.updateMany({ where: { id, labId: auth.labId, version: input.version }, data: { stockQuantity: input.quantity, version: { increment: 1 } } });
    if (changed.count !== 1) throw new AppError(ErrorCategory.BUSINESS_CONFLICT, '库存已变化，请刷新后重新盘点');
    await tx.reagentLog.create({ data: { reagentId: id, action: delta > 0 ? 'STOCK_IN' : 'STOCK_OUT', quantity: Math.abs(delta), operatorId: auth.userId, note: `盘点调整：${input.reason}（${before.stockQuantity} → ${input.quantity} ${before.unit || ''}）` } });
    await logAudit({ operatorId: auth.userId, labId: auth.labId, action: 'UPDATE', targetType: 'REAGENT', targetId: id, beforeData: { stockQuantity: before.stockQuantity }, afterData: { stockQuantity: input.quantity }, note: input.reason }, tx);
    return tx.reagent.findUniqueOrThrow({ where: { id } });
  });
  return NextResponse.json({ data, message: '盘点已保存，并生成调整流水' });
});
