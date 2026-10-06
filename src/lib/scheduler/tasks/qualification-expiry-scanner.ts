/**
 * 定时任务：资质到期扫描
 *
 * 每日 09:00 扫描所有用户资质，处理两类情况：
 * 1. 已过期但状态仍为 VALID：标记为 EXPIRED + 推送 URGENT 通知
 * 2. 30 天内将过期：推送 HIGH 通知（提前预警，避免临期才发现）
 *
 * 防重复策略：通过 Notification.relatedId+type 检查 24 小时内是否已推送，
 * 避免因 cron 多次触发而造成通知轰炸。
 *
 * 频率：每日 09:00 执行
 * 表达式：0 9 * * *
 */

import type { ScheduledTask } from '../types';
import { prisma } from '@/lib/prisma';

/** 提前预警天数 */
const EXPIRY_WARNING_DAYS = 30;
/** 防重复窗口（毫秒）：24 小时 */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

export const qualificationExpiryScannerTask: ScheduledTask = {
  name: 'qualification-expiry-scanner',
  schedule: '0 9 * * *', // 每日 09:00
  description: '扫描已过期/即将过期（30 天内）的用户资质，更新状态并推送通知',
  timeoutMs: 3 * 60 * 1000, // 3 分钟超时
  handler: async () => {
    const now = new Date();
    const warningThreshold = new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000);

    // ─── 1. 处理已过期：VALID → EXPIRED ───
    const expired = await prisma.userQualification.findMany({
      where: {
        status: 'VALID',
        expireAt: { lt: now },
      },
      include: {
        user: { select: { id: true, name: true, labId: true } },
        qualification: { select: { id: true, name: true } },
      },
      take: 200, // 单次最多处理 200 条
    });

    let expiredMarked = 0;
    for (const uq of expired) {
      try {
        // 用户未关联实验室时跳过通知（Notification.labId 不可为 null）
        if (!uq.user.labId) {
          await prisma.userQualification.update({
            where: { id: uq.id },
            data: { status: 'EXPIRED' },
          });
          expiredMarked++;
          continue;
        }
        // 状态更新 + 通知放在同一事务中，避免通知丢失
        await prisma.$transaction([
          prisma.userQualification.update({
            where: { id: uq.id },
            data: { status: 'EXPIRED' },
          }),
          prisma.notification.create({
            data: {
              recipientId: uq.userId,
              labId: uq.user.labId,
              type: 'QUALIFICATION_EXPIRING',
              title: `资质已过期：${uq.qualification.name}`,
              content: `您的资质「${uq.qualification.name}」已于 ${uq.expireAt.toISOString().slice(0, 10)} 过期，请尽快重新培训并申请授权。`,
              priority: 'URGENT',
              relatedType: 'UserQualification',
              relatedId: uq.id,
              actionUrl: '/user/qualifications',
            },
          }),
        ]);
        expiredMarked++;
      } catch (err) {
        console.error(`[scheduler] 资质 ${uq.id} 过期处理失败:`, err);
      }
    }

    // ─── 2. 处理即将过期（30 天内）：仅推送预警通知 ───
    const expiringSoon = await prisma.userQualification.findMany({
      where: {
        status: 'VALID',
        expireAt: {
          gte: now,
          lte: warningThreshold,
        },
      },
      include: {
        user: { select: { id: true, name: true, labId: true } },
        qualification: { select: { id: true, name: true } },
      },
      take: 500,
    });

    let warningSent = 0;
    const dedupSince = new Date(now.getTime() - DEDUP_WINDOW_MS);
    for (const uq of expiringSoon) {
      try {
        // 用户未关联实验室时跳过通知
        if (!uq.user.labId) continue;
        // 防重复：24 小时内已推送过相同 relatedId 的 QUALIFICATION_EXPIRING 通知则跳过
        const existing = await prisma.notification.findFirst({
          where: {
            relatedType: 'UserQualification',
            relatedId: uq.id,
            type: 'QUALIFICATION_EXPIRING',
            createdAt: { gte: dedupSince },
          },
          select: { id: true },
        });
        if (existing) continue;

        const daysLeft = Math.ceil((uq.expireAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        await prisma.notification.create({
          data: {
            recipientId: uq.userId,
            labId: uq.user.labId,
            type: 'QUALIFICATION_EXPIRING',
            title: `资质即将过期：${uq.qualification.name}`,
            content: `您的资质「${uq.qualification.name}」将在 ${daysLeft} 天后过期（${uq.expireAt
              .toISOString()
              .slice(0, 10)}），请及时续期。`,
            priority: 'HIGH',
            relatedType: 'UserQualification',
            relatedId: uq.id,
            actionUrl: '/user/qualifications',
          },
        });
        warningSent++;
      } catch (err) {
        console.error(`[scheduler] 资质 ${uq.id} 预警推送失败:`, err);
      }
    }

    console.log(
      `[scheduler] 资质扫描完成：标记过期 ${expiredMarked}/${expired.length}，预警推送 ${warningSent}/${expiringSoon.length}`
    );
  },
};

export default qualificationExpiryScannerTask;
