import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { z } from 'zod';

const updateAnnouncementSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(5000).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED']).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  isRecurring: z.boolean().optional(),
  recurringPattern: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).optional(),
  recurringTime: z.string().nullable().optional(),
  recurringDayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
  recurringDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
});

/** GET /api/announcements/[id] - 管理员查询通告详情 */
export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authResult = await requireAdmin(_request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const announcement = await prisma.announcement.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { reads: true } },
    },
  });

  if (!announcement) {
    return NextResponse.json({ error: '通告不存在' }, { status: 404 });
  }
  if (authResult.labId && announcement.labId !== authResult.labId) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  return NextResponse.json({ data: announcement });
});

/** PATCH /api/announcements/[id] - 管理员更新通告 */
export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: '通告不存在' }, { status: 404 });
  }
  if (authResult.labId && existing.labId !== authResult.labId) {
    return NextResponse.json({ error: '无权操作' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = updateAnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title;
  if (parsed.data.content !== undefined) updateData.content = parsed.data.content;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.scheduledAt !== undefined) {
    updateData.scheduledAt = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null;
  }
  if (parsed.data.isRecurring !== undefined) {
    updateData.isRecurring = parsed.data.isRecurring && parsed.data.status !== 'DRAFT';
  }
  if (parsed.data.recurringPattern !== undefined) {
    updateData.recurringPattern = parsed.data.recurringPattern;
  }
  if (parsed.data.recurringTime !== undefined) {
    updateData.recurringTime = parsed.data.recurringTime || null;
  }
  if (parsed.data.recurringDayOfWeek !== undefined) {
    updateData.recurringDayOfWeek = parsed.data.recurringDayOfWeek ?? null;
  }
  if (parsed.data.recurringDayOfMonth !== undefined) {
    updateData.recurringDayOfMonth = parsed.data.recurringDayOfMonth ?? null;
  }

  const updated = await prisma.announcement.update({
    where: { id },
    data: updateData,
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { reads: true } },
    },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'UPDATE',
    targetType: 'INSPECTION',
    targetId: id,
    targetName: updated.title,
    beforeData: {
      title: existing.title,
      status: existing.status,
      isRecurring: existing.isRecurring,
    },
    afterData: updateData,
    note: `更新通告「${updated.title}」`,
    labId: authResult.labId,
  });

  return NextResponse.json({ data: updated, message: '通告已更新' });
});

/** DELETE /api/announcements/[id] - 管理员删除通告 */
export const DELETE = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authResult = await requireAdmin(_request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: '通告不存在' }, { status: 404 });
  }
  if (authResult.labId && existing.labId !== authResult.labId) {
    return NextResponse.json({ error: '无权操作' }, { status: 403 });
  }

  await prisma.announcement.delete({ where: { id } });

  await logAudit({
    operatorId: authResult.userId,
    action: 'DELETE',
    targetType: 'INSPECTION',
    targetId: id,
    targetName: existing.title,
    note: `删除通告「${existing.title}」`,
    labId: authResult.labId,
  });

  return NextResponse.json({ message: '通告已删除' });
});
