import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { updateDeviceSchema } from '@/lib/validations/device';
import { deviceService } from '@/lib/services';
import { requireAuth, requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 校验设备是否属于当前用户的实验室
 * 返回 true 表示归属正确，false 表示越权访问
 */
async function checkDeviceOwnership(deviceId: string, labId?: string): Promise<boolean> {
  if (!labId) return false;
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { labId: true },
  });
  return !!device && device.labId === labId;
}

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

  const device = await deviceService.getDevice(id);
  return NextResponse.json(device);
});

export const PUT = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
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
  const parsed = updateDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '输入校验失败', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const device = await deviceService.updateDevice(id, parsed.data, authResult.userId);
  return NextResponse.json(device);
});

export const DELETE = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
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

  await deviceService.deleteDevice(id);
  return NextResponse.json({ message: '删除成功' });
});
