import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { reagentService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

/**
 * GET /api/reagents/lookup?name=xxx&casNumber=yyy
 *
 * 查询同名/同CAS号的试剂 siblings（不同规格批次），用于：
 * 1. 入库时自动填入上次储存位置（用户确认）
 * 2. 显示同试剂的所有规格批次与总量预估
 *
 * 返回：
 *   {
 *     siblings: ReagentSibling[],
 *     lastStorageLocation: string | null  // 最近一次入库的储存位置
 *   }
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || undefined;
  const casNumber = searchParams.get('casNumber') || undefined;
  const excludeId = searchParams.get('excludeId') || undefined;

  if (!name && !casNumber) {
    return NextResponse.json({ siblings: [], lastStorageLocation: null });
  }

  const siblings = await reagentService.findReagentSiblings({
    name,
    casNumber,
    labId: ctx.labId,
    excludeId: excludeId,
  });

  // 取最近一次入库的储存位置（siblings 已按 stockInDate desc 排序）
  const lastStorageLocation = siblings.find((s) => s.storageLocation)?.storageLocation ?? null;

  return NextResponse.json({
    siblings,
    lastStorageLocation,
  });
});
