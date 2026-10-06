import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { checkDeviceQualifications, formatQualificationError } from '@/lib/services/qualification.service';

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
 * GET /api/devices/[id]/reservations
 * 获取设备的预约列表（按时间范围）
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

  const { searchParams } = new URL(request.url);
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');

  const where: Record<string, unknown> = { deviceId: id };
  if (startDate && endDate) {
    where.OR = [
      { startTime: { gte: new Date(startDate), lte: new Date(endDate) } },
      { endTime: { gte: new Date(startDate), lte: new Date(endDate) } },
      { startTime: { lte: new Date(startDate) }, endTime: { gte: new Date(endDate) } },
    ];
  }
  // 排除已取消和已拒绝的
  where.status = { notIn: ['CANCELLED', 'REJECTED'] };

  const reservations = await prisma.deviceReservation.findMany({
    where,
    include: { user: { select: { id: true, name: true } } },
    orderBy: { startTime: 'asc' },
  });

  return NextResponse.json({ data: reservations });
});

/**
 * POST /api/devices/[id]/reservations
 * 创建设备预约
 * - LOW/MEDIUM 风险设备：直接 APPROVED
 * - HIGH/CRITICAL 风险设备：PENDING 待审批
 * - 事务保证时间冲突检测
 */
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
  const { startTime, endTime, purpose, fundInfo } = body;

  if (!startTime || !endTime) {
    return NextResponse.json({ error: '开始时间和结束时间不能为空' }, { status: 400 });
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (start >= end) {
    return NextResponse.json({ error: '结束时间必须晚于开始时间' }, { status: 400 });
  }
  if (start < new Date()) {
    return NextResponse.json({ error: '不能预约过去的时间' }, { status: 400 });
  }

  // 获取设备信息
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) {
    return NextResponse.json({ error: '设备不存在' }, { status: 404 });
  }
  if (device.status === 'SCRAPPED') {
    return NextResponse.json({ error: '设备已报废，不可预约' }, { status: 400 });
  }
  if (device.status === 'MAINTENANCE' || device.status === 'DISABLED') {
    return NextResponse.json({ error: '设备当前状态不可预约' }, { status: 400 });
  }

  // 资质校验：用户必须持有设备要求的所有有效资质
  const qualCheck = await checkDeviceQualifications(authResult.userId, id);
  if (!qualCheck.passed) {
    return NextResponse.json(
      { error: `资质校验未通过：${formatQualificationError(qualCheck)}` },
      { status: 403 }
    );
  }

  // 事务：冲突检测 + 创建预约
  const result = await prisma.$transaction(async (tx) => {
    // 检查时间冲突
    const conflicting = await tx.deviceReservation.findFirst({
      where: {
        deviceId: id,
        status: { in: ['PENDING', 'APPROVED', 'ACTIVE'] },
        // 时间重叠：newStart < existingEnd AND newEnd > existingStart
        AND: [
          { startTime: { lt: end } },
          { endTime: { gt: start } },
        ],
      },
    });

    if (conflicting) {
      throw new Error('所选时段已被占用，请选择其他时间');
    }

    // 根据设备风险等级决定是否需要审批
    const needsApproval = device.riskLevel === 'HIGH' || device.riskLevel === 'CRITICAL';
    const status = needsApproval ? 'PENDING' : 'APPROVED';

    const reservation = await tx.deviceReservation.create({
      data: {
        deviceId: id,
        userId: authResult.userId,
        startTime: start,
        endTime: end,
        purpose: purpose || null,
        fundInfo: fundInfo || null,
        status,
      },
      include: { user: { select: { id: true, name: true } } },
    });

    return { reservation, needsApproval };
  });

  // 写审计日志
  await logAudit({
    operatorId: authResult.userId,
    action: 'CREATE',
    targetType: 'RESERVATION',
    targetId: result.reservation.id,
    targetName: `${device.name} 预约`,
    labId: authResult.labId,
    afterData: {
      deviceId: id,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      purpose: purpose || null,
      fundInfo: fundInfo || null,
      status: result.reservation.status,
    },
    note: `预约设备「${device.name}」${result.needsApproval ? '（需审批）' : '（已自动通过）'}`,
  });

  return NextResponse.json({
    data: result.reservation,
    message: result.needsApproval ? '预约已提交，等待管理员审批' : '预约成功',
  });
});
