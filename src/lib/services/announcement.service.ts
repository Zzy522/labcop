import { prisma } from '@/lib/prisma';

/**
 * 通告服务
 * - 定时发布采用懒加载：GET 列表时检查 SCHEDULED 且 scheduledAt <= now() 的通告，自动转为 PUBLISHED
 * - 定期发送：检查 isRecurring 且 lastSpawnedAt 超过周期，自动派生新通告
 */

/** 懒加载发布到时间的定时通告，并派生定期通告的新一期 */
export async function publishDueAnnouncements(labId: string): Promise<void> {
  const now = new Date();

  // 1. 发布到时间的 SCHEDULED 通告
  const dueScheduled = await prisma.announcement.findMany({
    where: {
      labId,
      status: 'SCHEDULED',
      scheduledAt: { lte: now },
    },
    select: { id: true },
  });
  if (dueScheduled.length > 0) {
    await prisma.announcement.updateMany({
      where: { id: { in: dueScheduled.map((a) => a.id) } },
      data: { status: 'PUBLISHED' },
    });
  }

  // 2. 派生定期通告的新一期
  const recurring = await prisma.announcement.findMany({
    where: {
      labId,
      isRecurring: true,
      recurringPattern: { not: 'NONE' },
      status: 'PUBLISHED',
    },
  });

  for (const ann of recurring) {
    const base = ann.lastSpawnedAt ?? ann.createdAt;
    const next = computeNextSpawn(base, ann, now);
    // 已到下一周期：派生新一期（克隆标题/内容，重置时间为 now），并更新 lastSpawnedAt
    if (next && next <= now) {
      await prisma.announcement.create({
        data: {
          labId: ann.labId,
          title: ann.title,
          content: ann.content,
          status: 'PUBLISHED',
          isRecurring: false, // 派生出的单期不再递归
          recurringPattern: 'NONE',
          createdById: ann.createdById,
          lastSpawnedAt: now,
        },
      });
      await prisma.announcement.update({
        where: { id: ann.id },
        data: { lastSpawnedAt: now },
      });
    }
  }
}

/** 根据定期配置计算下一次派生时间 */
function computeNextSpawn(
  base: Date,
  ann: { recurringPattern: string; recurringTime: string | null; recurringDayOfWeek: number | null; recurringDayOfMonth: number | null },
  now: Date
): Date | null {
  const pattern = ann.recurringPattern;
  const timeStr = ann.recurringTime || '08:00';
  const [hh, mm] = timeStr.split(':').map(Number);
  const baseDate = new Date(base);

  if (pattern === 'DAILY') {
    // 每日 timeStr 发布：从 base 的下一天开始找
    const next = new Date(baseDate);
    next.setDate(next.getDate() + 1);
    next.setHours(hh || 8, mm || 0, 0, 0);
    while (next < now) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (pattern === 'WEEKLY') {
    // 每周 recurringDayOfWeek（1=周一..7=周日）的 timeStr 发布
    const targetDay = ann.recurringDayOfWeek ?? 1;
    const next = new Date(baseDate);
    next.setDate(next.getDate() + 1); // 从 base 的下一天开始
    next.setHours(hh || 8, mm || 0, 0, 0);
    // 找到下一个目标星期几
    let safety = 0;
    while (next < now || getDayOfWeekMonFirst(next) !== targetDay) {
      next.setDate(next.getDate() + 1);
      next.setHours(hh || 8, mm || 0, 0, 0);
      safety++;
      if (safety > 21) return null; // 安全阀：3周内必退出
    }
    return next;
  }

  if (pattern === 'MONTHLY') {
    // 每月 recurringDayOfMonth 号发布；若月份不足则取月底
    const targetDay = ann.recurringDayOfMonth ?? 1;
    const next = new Date(baseDate);
    next.setMonth(next.getMonth() + 1); // 下个月
    next.setDate(getValidDayOfMonth(next.getFullYear(), next.getMonth(), targetDay));
    next.setHours(hh || 8, mm || 0, 0, 0);
    let safety = 0;
    while (next < now) {
      next.setMonth(next.getMonth() + 1);
      next.setDate(getValidDayOfMonth(next.getFullYear(), next.getMonth(), targetDay));
      next.setHours(hh || 8, mm || 0, 0, 0);
      safety++;
      if (safety > 12) return null;
    }
    return next;
  }

  return null;
}

/** 将 Date 转为周一=1..周日=7 */
function getDayOfWeekMonFirst(d: Date): number {
  const jsDay = d.getDay(); // 0=周日..6=周六
  return jsDay === 0 ? 7 : jsDay;
}

/** 获取该月有效日期：若 targetDay 超过月底，返回月底 */
function getValidDayOfMonth(year: number, month: number, targetDay: number): number {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return Math.min(targetDay, lastDay);
}

/** 查询实验室已发布通告列表（实验员视角，附带当前用户已读状态） */
export async function listPublishedAnnouncements(labId: string, userId: string) {
  await publishDueAnnouncements(labId);
  const list = await prisma.announcement.findMany({
    where: { labId, status: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    include: {
      reads: {
        where: { userId },
        select: { id: true, readAt: true },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });
  return list.map((a) => ({
    id: a.id,
    title: a.title,
    content: a.content,
    createdAt: a.createdAt,
    llmOptimized: a.llmOptimized,
    createdBy: a.createdBy,
    isRead: a.reads.length > 0,
    readAt: a.reads[0]?.readAt ?? null,
  }));
}

/** 管理员查询实验室所有通告（含草稿/定时） */
export async function listAllAnnouncements(labId: string) {
  await publishDueAnnouncements(labId);
  return prisma.announcement.findMany({
    where: { labId },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true } },
      _count: { select: { reads: true } },
    },
  });
}

/** 查询通告已读人员名单（管理员） */
export async function listAnnouncementReaders(announcementId: string) {
  const reads = await prisma.announcementRead.findMany({
    where: { announcementId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { readAt: 'desc' },
  });
  return reads.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.user.name,
    userEmail: r.user.email,
    readAt: r.readAt,
  }));
}

/** 标记通告已读（幂等） */
export async function markAnnouncementRead(
  announcementId: string,
  userId: string
) {
  await prisma.announcementRead.upsert({
    where: {
      announcementId_userId: { announcementId, userId },
    },
    update: {}, // 已读不重复更新时间
    create: { announcementId, userId },
  });
}
