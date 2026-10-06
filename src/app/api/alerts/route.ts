import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { alertService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

export const GET = withErrorHandler(async (request: NextRequest) => {
  // 认证：必须登录
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 数据隔离：必须有 labId
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室，无法查询预警' }, { status: 403 });
  }

  // 按实验室隔离数据
  const data = await alertService.getAlertsData(authResult.labId);
  return NextResponse.json(data);
});
