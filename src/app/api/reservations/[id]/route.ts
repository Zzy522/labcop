import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/reservations/[id]
 * 获取预约详情
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;
  const reservation = await prisma.deviceReservation.findUnique({
    where: { id },
    include: {
      device: { select: { id: true, name: true, riskLevel: true, labId: true } },
      user: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
    },
  });

  if (!reservation) {
    return NextResponse.json({ error: '预约不存在' }, { status: 404 });
  }

  // IDOR 修复：通过 device.labId 校验预约归属
  if (reservation.device.labId !== authResult.labId) {
    return NextResponse.json({ error: '预约不存在或无权访问' }, { status: 404 });
  }

  return NextResponse.json({ data: reservation });
});

/**
 * PATCH /api/reservations/[id]
 * 操作预约：
 * - 管理员：审批通过/拒绝（status: APPROVED/REJECTED）
 * - 实验员：取消自己的预约（status: CANCELLED）
 */
export const PATCH = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { action, note } = body as { action: string; note?: string };

  const reservation = await prisma.deviceReservation.findUnique({
    where: { id },
    include: { device: { select: { id: true, name: true, riskLevel: true, labId: true } } },
  });
  if (!reservation) {
    return NextResponse.json({ error: '预约不存在' }, { status: 404 });
  }

  // IDOR 修复：通过 device.labId 校验预约归属
  if (reservation.device.labId !== authResult.labId) {
    return NextResponse.json({ error: '预约不存在或无权访问' }, { status: 404 });
  }

  // 取消：本人或管理员
  if (action === 'CANCEL') {
    if (reservation.userId !== authResult.userId && authResult.role !== 'ADMIN') {
      return NextResponse.json({ error: '无权取消他人预约' }, { status: 403 });
    }
    if (reservation.status === 'CANCELLED' || reservation.status === 'REJECTED') {
      return NextResponse.json({ error: '预约已取消或拒绝，无法重复操作' }, { status: 400 });
    }
    // 已完成或进行中不能取消
    if (reservation.status === 'ACTIVE' || reservation.status === 'COMPLETED') {
      return NextResponse.json({ error: '预约进行中或已完成，无法取消' }, { status: 400 });
    }

    const updated = await prisma.deviceReservation.update({
      where: { id },
      data: { status: 'CANCELLED', note: note || '用户取消' },
    });

    await logAudit({
      operatorId: authResult.userId,
      action: 'STATUS_CHANGE',
      targetType: 'RESERVATION',
      targetId: id,
      targetName: `${reservation.device.name} 预约`,
      beforeData: { status: reservation.status },
      afterData: { status: 'CANCELLED' },
      note: `取消预约${note ? `：${note}` : ''}`,
      labId: authResult.labId,
    });

    return NextResponse.json({ data: updated, message: '预约已取消' });
  }

  // 审批：仅管理员
  if (action === 'APPROVE' || action === 'REJECT') {
    const adminCheck = await requireAdmin(request);
    if (!isUserContext(adminCheck)) return adminCheck;

    if (reservation.status !== 'PENDING') {
      return NextResponse.json({ error: '仅待审批的预约可执行此操作' }, { status: 400 });
    }

    // 原子状态守卫：仅当当前仍为 PENDING 时才流转，防并发重复审批
    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const guarded = await prisma.deviceReservation.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: newStatus,
        reviewedById: authResult.userId,
        reviewedAt: new Date(),
        note: note || (action === 'APPROVE' ? '审批通过' : '审批拒绝'),
      },
    });
    if (guarded.count === 0) {
      return NextResponse.json({ error: '预约已被处理或状态已变更，请刷新后重试' }, { status: 409 });
    }

    const updated = await prisma.deviceReservation.findUnique({
      where: { id },
      include: { device: { select: { id: true, name: true } } },
    });

    await logAudit({
      operatorId: authResult.userId,
      action: 'STATUS_CHANGE',
      targetType: 'RESERVATION',
      targetId: id,
      targetName: `${reservation.device.name} 预约`,
      beforeData: { status: reservation.status },
      afterData: { status: newStatus, note: note || null },
      note: `${action === 'APPROVE' ? '审批通过' : '审批拒绝'}${note ? `：${note}` : ''}`,
      labId: authResult.labId,
    });

    return NextResponse.json({
      data: updated,
      message: action === 'APPROVE' ? '已通过预约' : '已拒绝预约',
    });
  }

  return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
});
