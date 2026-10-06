import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { z } from 'zod';

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

/**
 * GET /api/devices/[id]/qualifications
 * 获取设备要求的资质列表
 */
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

  const requirements = await prisma.deviceQualification.findMany({
    where: { deviceId: id },
    include: { qualification: true },
  });

  return NextResponse.json({ data: requirements });
});

const setQualificationsSchema = z.object({
  qualificationIds: z.array(z.string().min(1)),
});

/**
 * PUT /api/devices/[id]/qualifications
 * 设置设备要求的资质（全量替换，仅管理员）
 */
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
  const parsed = setQualificationsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  const device = await prisma.device.findUnique({ where: { id }, select: { name: true } });
  if (!device) {
    return NextResponse.json({ error: '设备不存在' }, { status: 404 });
  }

  const allowedCount = await prisma.qualification.count({
    where: { id: { in: parsed.data.qualificationIds }, OR: [{ labId: authResult.labId }, { scope: 'PLATFORM' }] },
  });
  if (allowedCount !== new Set(parsed.data.qualificationIds).size) return NextResponse.json({ error: '包含其他实验室或不存在的资质模板' }, { status: 403 });

  // 事务：删除旧的 + 创建新的
  await prisma.$transaction([
    prisma.deviceQualification.deleteMany({ where: { deviceId: id } }),
    prisma.deviceQualification.createMany({
      data: parsed.data.qualificationIds.map((qualificationId) => ({ deviceId: id, qualificationId })),
    }),
  ]);

  // 获取资质名称用于审计
  const qualifications = await prisma.qualification.findMany({
    where: { id: { in: parsed.data.qualificationIds }, OR: [{ labId: authResult.labId }, { scope: 'PLATFORM' }] },
    select: { name: true },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'UPDATE',
    targetType: 'DEVICE',
    targetId: id,
    targetName: device.name,
    labId: authResult.labId,
    afterData: { requiredQualifications: qualifications.map((q) => q.name) },
    note: `设置设备「${device.name}」要求资质：${qualifications.map((q) => q.name).join('、') || '无'}`,
  });

  return NextResponse.json({ message: '设备资质要求已更新' });
});
