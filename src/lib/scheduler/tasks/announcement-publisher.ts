/**
 * 定时任务：通告定时发布
 *
 * 扫描 status=SCHEDULED 且 scheduledAt <= now 的通告，将其状态改为 PUBLISHED。
 * 同时处理定期发送（recurringPattern != NONE）：到达下次发送时间时派生新通告。
 *
 * 频率：每 5 分钟执行一次
 * 表达式：`* /5 * * * *`（去除空格）
 */

import type { ScheduledTask } from '../types';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@/generated/prisma/client';

export const announcementPublisherTask: ScheduledTask = {
  name: 'announcement-publisher',
  schedule: '*/5 * * * *', // 每 5 分钟
  description: '扫描定时发布的通告并发布，同时处理定期发送派生',
  timeoutMs: 2 * 60 * 1000, // 2 分钟超时
  runOnStartup: true, // 启动时补偿执行一次
  handler: async () => {
    const now = new Date();

    // 1. 发布所有到时间的 SCHEDULED 通告
    const scheduledAnnouncements = await prisma.announcement.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledAt: { lte: now },
      },
      take: 50, // 单次最多处理 50 条
    });

    let publishedCount = 0;
    for (const ann of scheduledAnnouncements) {
      try {
        // 派生 + 发布放在同一事务中，避免派生成功但发布失败导致下次重复派生
        await prisma.$transaction(async (tx) => {
          // 如果是定期发送，先派生下一次（在事务内创建新通告）
          if (
            ann.isRecurring &&
            ann.recurringPattern &&
            ann.recurringPattern !== 'NONE'
          ) {
            // 防重复派生：检查 lastSpawnedAt 是否已与当前 scheduledAt 同日
            // （若上次派生时间已覆盖本次 scheduledAt，说明已派生过，跳过）
            if (ann.scheduledAt && (!ann.lastSpawnedAt || ann.lastSpawnedAt < ann.scheduledAt)) {
              await spawnRecurringAnnouncement(ann, now, tx);
            }
          }
          // 发布当前通告
          await tx.announcement.update({
            where: { id: ann.id },
            data: {
              status: 'PUBLISHED',
              lastSpawnedAt: now,
            },
          });
        });
        publishedCount++;
      } catch (err) {
        console.error(`[scheduler] 通告 ${ann.id} 发布失败:`, err);
      }
    }

    if (publishedCount > 0) {
      console.log(`[scheduler] 通告发布任务完成：成功 ${publishedCount}/${scheduledAnnouncements.length} 条`);
    }
  },
};

/**
 * 派生定期发送的下一次通告
 *
 * 逻辑：
 * - DAILY：第二天同一时间发布
 * - WEEKLY：下一周同一天发布
 * - MONTHLY：下月同一天发布
 * - 派生的新通告 status=SCHEDULED，scheduledAt=下次时间
 */
async function spawnRecurringAnnouncement(
  parent: {
    id: string;
    labId: string;
    title: string;
    content: string;
    createdById: string;
    recurringPattern: string;
    recurringTime: string | null;
    recurringDayOfWeek: number | null;
    recurringDayOfMonth: number | null;
    scheduledAt: Date | null;
  },
  now: Date,
  tx?: Prisma.TransactionClient
): Promise<void> {
  if (!parent.scheduledAt) return;

  let nextScheduledAt: Date;
  if (parent.recurringPattern === 'DAILY') {
    nextScheduledAt = new Date(parent.scheduledAt);
    nextScheduledAt.setDate(nextScheduledAt.getDate() + 1);
  } else if (parent.recurringPattern === 'WEEKLY') {
    nextScheduledAt = new Date(parent.scheduledAt);
    nextScheduledAt.setDate(nextScheduledAt.getDate() + 7);
  } else if (parent.recurringPattern === 'MONTHLY') {
    nextScheduledAt = new Date(parent.scheduledAt);
    nextScheduledAt.setMonth(nextScheduledAt.getMonth() + 1);
  } else {
    return; // 未知 pattern 不处理
  }

  // 创建下次派生通告（标题加下次发布日期标记，便于识别）
  const client = tx ?? prisma;
  await client.announcement.create({
    data: {
      labId: parent.labId,
      title: `${parent.title}（${nextScheduledAt.toISOString().slice(0, 10)}）`,
      content: parent.content,
      status: 'SCHEDULED',
      scheduledAt: nextScheduledAt,
      isRecurring: true,
      recurringPattern: parent.recurringPattern,
      recurringTime: parent.recurringTime,
      recurringDayOfWeek: parent.recurringDayOfWeek,
      recurringDayOfMonth: parent.recurringDayOfMonth,
      createdById: parent.createdById,
      // 派生标记，便于溯源
      lastSpawnedAt: now,
    },
  });
}

export default announcementPublisherTask;
