import { NextRequest, NextResponse } from 'next/server';
import { parsePagination, paginatedResponse, withErrorHandler } from '@/lib/api-utils';
import { createDeviceSchema } from '@/lib/validations/device';
import { deviceService } from '@/lib/services';
import { requireAdmin, requireAuth, isUserContext } from '@/lib/auth-middleware';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { page, pageSize } = parsePagination(searchParams, 12);

  // 认证：必须登录
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;

  // 权限隔离：所有角色只能查看本实验室设备（admin 不例外，跨实验室隔离）
  if (!ctx.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }
  const labId = ctx.labId;

  const result = await deviceService.listDevices({
    search: searchParams.get('search') || undefined,
    riskLevel: searchParams.get('riskLevel') || undefined,
    status: searchParams.get('status') || undefined,
    labId,
    page,
    pageSize,
  });

  return NextResponse.json(paginatedResponse(result.data, result.total, result.page, result.pageSize));
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  // 权限检查：仅管理员可创建设备
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const body = await request.json();
  const parsed = createDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '输入校验失败', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // 安全修复：强制使用认证用户的 labId，忽略请求体中的 labId
  if (!authResult.labId) {
    return NextResponse.json({ error: '当前用户未关联实验室，无法创建设备' }, { status: 400 });
  }
  const device = await deviceService.createDevice({ ...parsed.data, labId: authResult.labId });
  return NextResponse.json(device, { status: 201 });
});
