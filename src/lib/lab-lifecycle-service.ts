import 'server-only';

import { prisma } from '@/lib/prisma';
import { platformAuditData } from '@/lib/platform-audit';
import { cancelLabDeletion, canFinalizeLabDeletion, scheduleLabDeletion } from '@/lib/lab-lifecycle';

export async function requestLabDeletion(labId: string, operatorId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const lab = await tx.lab.findUnique({ where: { id: labId } });
    if (!lab) throw new Error('LAB_NOT_FOUND');
    const lifecycle = scheduleLabDeletion(lab.status, now);
    const updated = await tx.lab.update({
      where: { id: labId },
      data: { ...lifecycle, deletionRequestedById: operatorId, deletedAt: null },
    });
    await tx.platformAuditLog.create({
      data: platformAuditData({
        operatorId,
        action: 'SCHEDULE_LAB_DELETION',
        targetType: 'LAB',
        targetId: labId,
        before: { status: lab.status },
        after: { status: updated.status, deletionScheduledAt: updated.deletionScheduledAt },
        note: '实验室进入 7 天删除等待期',
      }),
    });
    return updated;
  });
}

export async function cancelRequestedLabDeletion(labId: string, operatorId: string) {
  return prisma.$transaction(async (tx) => {
    const lab = await tx.lab.findUnique({ where: { id: labId } });
    if (!lab) throw new Error('LAB_NOT_FOUND');
    if (lab.status !== 'PENDING_DELETION') throw new Error('LAB_NOT_PENDING_DELETION');
    const nextStatus = cancelLabDeletion(lab.deletionPreviousStatus);
    const updated = await tx.lab.update({
      where: { id: labId },
      data: {
        status: nextStatus,
        deletionPreviousStatus: null,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
        deletionRequestedById: null,
      },
    });
    await tx.platformAuditLog.create({
      data: platformAuditData({
        operatorId,
        action: 'CANCEL_LAB_DELETION',
        targetType: 'LAB',
        targetId: labId,
        before: { status: lab.status, deletionScheduledAt: lab.deletionScheduledAt },
        after: { status: nextStatus },
      }),
    });
    return updated;
  });
}

export async function finalizeLabDeletion(
  labId: string,
  operatorId: string,
  options: { immediate?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const result = await prisma.$transaction(async (tx) => {
    const lab = await tx.lab.findUnique({
      where: { id: labId },
      include: { memberships: { where: { status: 'ACTIVE' }, select: { userId: true } } },
    });
    if (!lab) throw new Error('LAB_NOT_FOUND');
    if (!canFinalizeLabDeletion(lab.status, lab.deletionScheduledAt, now, options.immediate)) {
      throw new Error('LAB_DELETION_WAITING');
    }

    const affectedUserIds = [...new Set(lab.memberships.map((membership) => membership.userId))];
    const changed = await tx.lab.updateMany({ where: { id: labId, status: 'PENDING_DELETION' }, data: { status: 'DELETED', deletedAt: now } });
    if (changed.count !== 1) throw new Error('LAB_STATUS_CHANGED');
    await tx.platformAuditLog.create({ data: platformAuditData({ operatorId, action: 'ARCHIVE_LAB', targetType: 'LAB', targetId: labId, before: { status: lab.status }, after: { status: 'DELETED', deletedAt: now }, note: '实验室已归档，所有业务数据与文件保留，可恢复' }) });
    return { lab: { id: labId, status: 'DELETED' as const, deletedAt: now }, affectedUserIds };
  });
  return result;
}

export async function finalizeExpiredLabDeletions(now = new Date()) {
  const labs = await prisma.lab.findMany({
    where: { status: 'PENDING_DELETION', deletionScheduledAt: { lte: now }, deletionRequestedById: { not: null } },
    select: { id: true, deletionRequestedById: true },
  });
  let finalized = 0;
  for (const lab of labs) {
    if (!lab.deletionRequestedById) continue;
    await finalizeLabDeletion(lab.id, lab.deletionRequestedById, { now });
    finalized += 1;
  }
  return finalized;
}
