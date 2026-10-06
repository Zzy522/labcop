import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { alertService } from '@/lib/services';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const PATCH = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const { id } = await params;

  // 权限检查：仅管理员可解决风险事件
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  const event = await alertService.resolveRiskEvent(id, authResult.userId, authResult.labId);
  return NextResponse.json(event);
});
