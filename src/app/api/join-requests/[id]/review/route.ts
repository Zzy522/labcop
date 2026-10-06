import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireLabOwner, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { z } from 'zod';

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  rejectReason: z.string().max(200, '拒绝原因过长').optional(),
});

/**
 * PATCH /api/join-requests/[id]/review
 * 管理员审批入组申请。
 *
 * - approve：事务内 JoinRequest→APPROVED + User.labId→本实验室
 * - reject：JoinRequest→REJECTED + rejectReason
 *
 * 权限：仅本实验室管理员可审批本实验室的申请。
 */
export const PATCH = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const authResult = await requireLabOwner(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 400 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '输入校验失败', details: parsed.error.flatten() }, { status: 400 });
  }

  // 取申请，校验归属
  const req = await prisma.joinRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, labMemberships: { where: { status: 'ACTIVE' }, select: { labId: true } } } },
      lab: { select: { id: true, name: true, ownerId: true } },
    },
  });
  if (!req) {
    return NextResponse.json({ error: '申请不存在' }, { status: 404 });
  }
  // 跨实验室隔离：只能审批本实验室的申请
  if (req.labId !== authResult.labId) {
    return NextResponse.json({ error: '无权审批该申请' }, { status: 403 });
  }
  if (req.status !== 'PENDING') {
    return NextResponse.json({ error: '该申请已处理' }, { status: 400 });
  }

  // 核心管理员校验：审批加入申请仅限本实验室核心管理员（ownerId）。
  // 兼容旧数据：ownerId 为 null 时允许任何本实验室管理员审批。
  if (req.lab.ownerId && req.lab.ownerId !== authResult.userId) {
    return NextResponse.json({ error: '仅实验室核心管理员可审批加入申请' }, { status: 403 });
  }

  if (parsed.data.action === 'approve') {
    // 申请人若已加入其他实验室则拒绝
    if (req.user.labMemberships.length > 0) {
      return NextResponse.json(
        { error: '该申请人已加入其他实验室，无法批准' },
        { status: 400 }
      );
    }

    // 事务：更新申请 + 分配实验室
    await prisma.$transaction([
      prisma.joinRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: authResult.userId,
          reviewedAt: new Date(),
        },
      }),
      prisma.user.update({
        where: { id: req.userId, status: { not: 'RETIRED' } },
        data: { labId: req.labId, role: req.role === 'ADMIN' ? 'ADMIN' : 'MEMBER', status: 'ACTIVE', statusChangedAt: new Date() },
      }),
      prisma.labMembership.create({
        data: { labId: req.labId, userId: req.userId, role: req.role === 'ADMIN' ? 'LAB_ADMIN' : 'LAB_MEMBER', status: 'ACTIVE', isPrimary: true, approvedById: authResult.userId, approvedAt: new Date() },
      }),
    ]);

    await logAudit({
      operatorId: authResult.userId,
      action: 'GRANT',
      targetType: 'USER',
      targetId: req.userId,
      targetName: req.user.name,
      afterData: { labId: req.labId, labName: req.lab.name, joinRequestId: id },
      note: `批准 ${req.user.email} 加入实验室「${req.lab.name}」`,
    });

    return NextResponse.json({
      data: { id, status: 'APPROVED', userId: req.userId, labId: req.labId },
      message: '已批准，该成员已加入实验室',
    });
  }

  // reject
  await prisma.joinRequest.update({
    where: { id },
    data: {
      status: 'REJECTED',
      reviewedById: authResult.userId,
      reviewedAt: new Date(),
      rejectReason: parsed.data.rejectReason || null,
    },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'REVOKE',
    targetType: 'USER',
    targetId: req.userId,
    targetName: req.user.name,
    afterData: { joinRequestId: id, rejectReason: parsed.data.rejectReason || null },
    note: `拒绝 ${req.user.email} 的入组申请`,
  });

  return NextResponse.json({
    data: { id, status: 'REJECTED' },
    message: '已拒绝该申请',
  });
});
