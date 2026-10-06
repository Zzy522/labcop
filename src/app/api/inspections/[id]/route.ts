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
 * GET /api/inspections/[id]
 * 获取巡检任务详情
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const inspection = await prisma.inspectionAssignment.findFirst({
    where: { id, labId: authResult.labId },
    include: {
      assignee: { select: { id: true, name: true } },
      assigner: { select: { id: true, name: true } },
    },
  });

  if (!inspection) {
    return NextResponse.json({ error: '巡检任务不存在' }, { status: 404 });
  }

  // 实验员只能看自己的任务
  if (authResult.role !== 'ADMIN' && inspection.assigneeId !== authResult.userId) {
    return NextResponse.json({ error: '无权查看此巡检任务' }, { status: 403 });
  }

  return NextResponse.json({ data: inspection });
});

const submitSchema = z.object({
  action: z.literal('SUBMIT'),
  submittedData: z.string().max(10000, '提交数据过长').optional(),
  photoUrls: z.array(z.string().url()).max(10, '最多10张照片').optional(),
  note: z.string().max(500).optional(),
});

const reviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reviewNote: z.string().max(500).optional(),
});

/**
 * PATCH /api/inspections/[id]
 * - 实验员提交（action: SUBMIT）
 * - 管理员审核（action: APPROVE/REJECT）
 */
export const PATCH = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const body = await request.json();

  const inspection = await prisma.inspectionAssignment.findFirst({
    where: { id, labId: authResult.labId },
    include: {
      assignee: { select: { id: true, name: true } },
      assigner: { select: { id: true, name: true } },
    },
  });
  if (!inspection) {
    return NextResponse.json({ error: '巡检任务不存在' }, { status: 404 });
  }

  // 实验员提交
  if (body.action === 'SUBMIT') {
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '参数错误' },
        { status: 400 }
      );
    }

    // 仅被派发的实验员可提交
    if (inspection.assigneeId !== authResult.userId) {
      return NextResponse.json({ error: '仅被派发人可提交巡检结果' }, { status: 403 });
    }
    if (inspection.status !== 'ASSIGNED') {
      return NextResponse.json({ error: '当前状态不可提交（任务可能已提交或已审核）' }, { status: 400 });
    }

    const updated = await prisma.inspectionAssignment.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedAt: new Date(),
        submittedData: parsed.data.submittedData || null,
        photoUrls: parsed.data.photoUrls ? JSON.stringify(parsed.data.photoUrls) : null,
      },
    });

    await logAudit({
      operatorId: authResult.userId,
      action: 'STATUS_CHANGE',
      targetType: 'INSPECTION',
      targetId: id,
      targetName: inspection.title,
      beforeData: { status: inspection.status },
      afterData: { status: 'SUBMITTED' },
      note: `提交巡检任务`,
    });

    return NextResponse.json({ data: updated, message: '巡检任务已提交，等待管理员审核' });
  }

  // 管理员审核
  if (body.action === 'APPROVE' || body.action === 'REJECT') {
    const adminCheck = await requireAdmin(request);
    if (!isUserContext(adminCheck)) return adminCheck;
    if (inspection.labId !== adminCheck.labId) return NextResponse.json({ error: '无权审核其他实验室任务' }, { status: 403 });

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '参数错误' },
        { status: 400 }
      );
    }

    if (inspection.status !== 'SUBMITTED') {
      return NextResponse.json({ error: '仅已提交的巡检任务可审核' }, { status: 400 });
    }

    const newStatus = body.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const updated = await prisma.inspectionAssignment.update({
      where: { id },
      data: {
        status: newStatus,
        reviewedAt: new Date(),
        reviewNote: parsed.data.reviewNote || null,
      },
    });

    await logAudit({
      operatorId: authResult.userId,
      action: 'STATUS_CHANGE',
      targetType: 'INSPECTION',
      targetId: id,
      targetName: inspection.title,
      beforeData: { status: inspection.status },
      afterData: { status: newStatus, reviewNote: parsed.data.reviewNote || null },
      note: `${body.action === 'APPROVE' ? '审核通过' : '审核拒绝'}巡检任务`,
    });

    return NextResponse.json({
      data: updated,
      message: body.action === 'APPROVE' ? '巡检任务已通过' : '巡检任务已拒绝',
    });
  }

  return NextResponse.json({ error: '不支持的操作' }, { status: 400 });
});
