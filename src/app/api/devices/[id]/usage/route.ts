import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { createDeviceUsageSchema } from '@/lib/validations/device';
import { deviceService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 校验设备是否属于当前用户的实验室
 */
async function checkDeviceOwnership(deviceId: string, labId?: string): Promise<boolean> {
  if (!labId) return false;
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { labId: true },
  });
  return !!device && device.labId === labId;
}

export const POST = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;

  // IDOR 修复：校验设备归属
  const owned = await checkDeviceOwnership(id, authResult.labId);
  if (!owned) {
    return NextResponse.json({ error: '设备不存在或无权访问' }, { status: 404 });
  }

  const body = await request.json();
  const parsed = createDeviceUsageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '输入校验失败', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // 安全修复：强制使用认证用户的 userId，忽略请求体中的 userId
  const usage = await deviceService.applyDeviceUsage(id, {
    ...parsed.data,
    userId: authResult.userId,
  });
  return NextResponse.json(usage, { status: 201 });
});

export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;

  // IDOR 修复：校验设备归属
  const owned = await checkDeviceOwnership(id, authResult.labId);
  if (!owned) {
    return NextResponse.json({ error: '设备不存在或无权访问' }, { status: 404 });
  }

  const usages = await deviceService.listDeviceUsages(id);
  return NextResponse.json(usages);
});
