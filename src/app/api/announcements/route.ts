import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import {
  listPublishedAnnouncements,
  listAllAnnouncements,
} from '@/lib/services/announcement.service';
import { z } from 'zod';

const createAnnouncementSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200),
  content: z.string().min(1, '内容不能为空').max(5000),
  // 状态：DRAFT | PUBLISHED | SCHEDULED
  status: z.enum(['DRAFT', 'PUBLISHED', 'SCHEDULED']).default('PUBLISHED'),
  scheduledAt: z.string().datetime().nullable().optional(),
  isRecurring: z.boolean().default(false),
  recurringPattern: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).default('NONE'),
  // 定期发送时间配置
  recurringTime: z.string().optional().nullable(), // HH:mm
  recurringDayOfWeek: z.number().int().min(1).max(7).optional().nullable(), // 1-7
  recurringDayOfMonth: z.number().int().min(1).max(31).optional().nullable(), // 1-31
  llmOptimized: z.boolean().default(false),
});

/**
 * GET /api/announcements
 * - 实验员：查询本实验室已发布通告，附带当前用户已读状态
 * - 管理员：查询本实验室所有通告（含草稿/定时），附带已读人数
 * ?all=1 管理员可强制查看全部
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  // 管理员默认看全部，实验员看已发布
  if (authResult.isAdmin) {
    const { searchParams } = new URL(request.url);
    const onlyPublished = searchParams.get('published') === '1';
    if (onlyPublished) {
      const data = await listPublishedAnnouncements(authResult.labId, authResult.userId);
      return NextResponse.json({ data });
    }
    const data = await listAllAnnouncements(authResult.labId);
    return NextResponse.json({ data });
  }

  const data = await listPublishedAnnouncements(authResult.labId, authResult.userId);
  return NextResponse.json({ data });
});

/**
 * POST /api/announcements
 * 管理员创建通告
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createAnnouncementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  const { title, content, status, scheduledAt, isRecurring, recurringPattern, recurringTime, recurringDayOfWeek, recurringDayOfMonth, llmOptimized } = parsed.data;

  // SCHEDULED 必须提供 scheduledAt
  if (status === 'SCHEDULED' && !scheduledAt) {
    return NextResponse.json(
      { error: '定时发布必须填写发布时间' },
      { status: 400 }
    );
  }

  // 定期发送必须 PUBLISHED 且 pattern 非 NONE
  if (isRecurring && recurringPattern === 'NONE') {
    return NextResponse.json(
      { error: '定期发送必须选择周期（每日/每周/每月）' },
      { status: 400 }
    );
  }

  // WEEKLY 必须选择星期几
  if (isRecurring && recurringPattern === 'WEEKLY' && !recurringDayOfWeek) {
    return NextResponse.json(
      { error: '每周定期发送必须选择星期几' },
      { status: 400 }
    );
  }

  // MONTHLY 必须选择几号
  if (isRecurring && recurringPattern === 'MONTHLY' && !recurringDayOfMonth) {
    return NextResponse.json(
      { error: '每月定期发送必须选择几号' },
      { status: 400 }
    );
  }

  const announcement = await prisma.announcement.create({
    data: {
      labId: authResult.labId,
      title,
      content,
      status,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      isRecurring: isRecurring && status === 'PUBLISHED',
      recurringPattern: isRecurring && status === 'PUBLISHED' ? recurringPattern : 'NONE',
      recurringTime: isRecurring && status === 'PUBLISHED' ? (recurringTime || '08:00') : null,
      recurringDayOfWeek: isRecurring && status === 'PUBLISHED' && recurringPattern === 'WEEKLY' ? recurringDayOfWeek : null,
      recurringDayOfMonth: isRecurring && status === 'PUBLISHED' && recurringPattern === 'MONTHLY' ? recurringDayOfMonth : null,
      llmOptimized,
      createdById: authResult.userId,
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { reads: true } },
    },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'CREATE',
    targetType: 'INSPECTION', // 复用现有 TargetType 枚举（通告无独立类型，记入 INSPECTION 桶）
    targetId: announcement.id,
    targetName: title,
    afterData: { title, status, isRecurring, recurringPattern },
    note: `创建通告「${title}」`,
    labId: authResult.labId,
  });

  return NextResponse.json({ data: announcement, message: '通告已创建' });
});
