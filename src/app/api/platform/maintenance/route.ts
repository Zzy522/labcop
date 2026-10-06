import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler } from '@/lib/api-utils';
import { isUserContext, requirePlatformAdmin } from '@/lib/auth-middleware';
import { MAINTENANCE_ID, getMaintenanceSnapshot } from '@/lib/maintenance';
import { syncMaintenanceFallbackState } from '@/lib/maintenance-static';
import { platformAuditData } from '@/lib/platform-audit';
import { prisma } from '@/lib/prisma';

const maintenanceSchema = z.object({
  enabled: z.boolean(),
  title: z.string().trim().min(1, '请填写维护页标题').max(100),
  message: z.string().trim().min(1, '请填写维护说明').max(1000),
  startsAt: z.string().datetime().nullable(),
  estimatedEndAt: z.string().datetime().nullable(),
  notifyUsers: z.boolean().default(false),
}).superRefine((value, context) => {
  if (value.startsAt && value.estimatedEndAt && new Date(value.startsAt) >= new Date(value.estimatedEndAt)) {
    context.addIssue({ code: 'custom', path: ['estimatedEndAt'], message: '预计完成时间必须晚于开始时间' });
  }
});

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const snapshot = await getMaintenanceSnapshot();
  await syncMaintenanceFallbackState(snapshot);
  return NextResponse.json({ data: snapshot });
});

export const PUT = withErrorHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const parsed = maintenanceSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '维护配置不正确' }, { status: 400 });
  }

  const input = parsed.data;
  const startsAt = input.startsAt ? new Date(input.startsAt) : null;
  const estimatedEndAt = input.estimatedEndAt ? new Date(input.estimatedEndAt) : null;
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.platformMaintenance.findUnique({ where: { id: MAINTENANCE_ID } });
    const config = await tx.platformMaintenance.upsert({
      where: { id: MAINTENANCE_ID },
      create: {
        id: MAINTENANCE_ID,
        enabled: input.enabled,
        title: input.title,
        message: input.message,
        startsAt,
        estimatedEndAt,
        lastNotifiedAt: input.notifyUsers ? now : null,
        updatedById: auth.userId,
      },
      update: {
        enabled: input.enabled,
        title: input.title,
        message: input.message,
        startsAt,
        estimatedEndAt,
        ...(input.notifyUsers ? { lastNotifiedAt: now } : {}),
        updatedById: auth.userId,
      },
    });

    let notificationCount = 0;
    if (input.notifyUsers) {
      const users = await tx.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      const timeText = estimatedEndAt
        ? `预计完成时间：${estimatedEndAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`
        : '预计完成时间：待定';
      const created = await tx.notification.createMany({
        data: users.map((user) => ({
          recipientId: user.id,
          labId: null,
          type: 'SYSTEM_MAINTENANCE',
          title: input.title,
          content: `${input.message}\n${timeText}`,
          priority: 'HIGH',
          relatedType: 'PlatformMaintenance',
          relatedId: MAINTENANCE_ID,
          actionUrl: '/maintenance',
        })),
      });
      notificationCount = created.count;
    }

    await tx.platformAuditLog.create({ data: platformAuditData({
      operatorId: auth.userId,
      action: input.notifyUsers ? 'UPDATE_MAINTENANCE_AND_NOTIFY' : 'UPDATE_MAINTENANCE',
      targetType: 'PlatformMaintenance',
      targetId: MAINTENANCE_ID,
      before,
      after: config,
      note: input.enabled ? '已配置/开启平台维护模式' : '已关闭平台维护模式',
    }) });
    return { notificationCount };
  });

  const snapshot = await getMaintenanceSnapshot();
  await syncMaintenanceFallbackState(snapshot);
  return NextResponse.json({
    data: snapshot,
    message: input.notifyUsers ? `配置已保存，并向 ${result.notificationCount} 名用户发送通知` : '维护配置已保存',
    notificationCount: result.notificationCount,
  });
});
