import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { reviewRequisitionSchema } from '@/lib/validations/requisition';
import { requisitionService } from '@/lib/services';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const PUT = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const { id } = await params;

  // 权限检查：仅管理员可审核
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  const body = await request.json();
  const parsed = reviewRequisitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '输入校验失败', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const result = await requisitionService.reviewRequisitionAction(id, parsed.data, authResult.userId, authResult.labId);
  return NextResponse.json(result);
});
