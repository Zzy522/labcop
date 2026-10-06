export const LAB_DELETION_WAIT_MS = 7 * 24 * 60 * 60 * 1000;

export type LabLifecycleStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING_DELETION' | 'DELETED';

export function scheduleLabDeletion(currentStatus: string, now = new Date()) {
  if (currentStatus !== 'ACTIVE' && currentStatus !== 'SUSPENDED') {
    throw new Error('LAB_NOT_SCHEDULABLE');
  }
  return {
    status: 'PENDING_DELETION' as const,
    deletionPreviousStatus: currentStatus,
    deletionRequestedAt: now,
    deletionScheduledAt: new Date(now.getTime() + LAB_DELETION_WAIT_MS),
  };
}

export function cancelLabDeletion(previousStatus: string | null) {
  return previousStatus === 'SUSPENDED' ? 'SUSPENDED' as const : 'ACTIVE' as const;
}

export function canFinalizeLabDeletion(
  status: string,
  scheduledAt: Date | null,
  now = new Date(),
  immediate = false,
) {
  return status === 'PENDING_DELETION' && (immediate || Boolean(scheduledAt && scheduledAt <= now));
}
