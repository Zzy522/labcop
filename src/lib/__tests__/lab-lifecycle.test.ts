import { describe, expect, it } from 'vitest';
import {
  LAB_DELETION_WAIT_MS,
  canFinalizeLabDeletion,
  cancelLabDeletion,
  scheduleLabDeletion,
} from '@/lib/lab-lifecycle';

describe('实验室删除生命周期', () => {
  const now = new Date('2026-08-20T10:00:00.000Z');

  it('首次删除会进入完整的 7 天等待期', () => {
    const result = scheduleLabDeletion('ACTIVE', now);
    expect(result.status).toBe('PENDING_DELETION');
    expect(result.deletionPreviousStatus).toBe('ACTIVE');
    expect(result.deletionScheduledAt.getTime() - now.getTime()).toBe(LAB_DELETION_WAIT_MS);
  });

  it('等待期内只能通过明确的立即删除二次确认完成', () => {
    const scheduledAt = new Date(now.getTime() + LAB_DELETION_WAIT_MS);
    expect(canFinalizeLabDeletion('PENDING_DELETION', scheduledAt, now)).toBe(false);
    expect(canFinalizeLabDeletion('PENDING_DELETION', scheduledAt, now, true)).toBe(true);
    expect(canFinalizeLabDeletion('ACTIVE', scheduledAt, now, true)).toBe(false);
  });

  it('等待期届满可自动完成，取消时恢复删除前状态', () => {
    expect(canFinalizeLabDeletion('PENDING_DELETION', now, now)).toBe(true);
    expect(cancelLabDeletion('SUSPENDED')).toBe('SUSPENDED');
    expect(cancelLabDeletion('ACTIVE')).toBe('ACTIVE');
  });

  it('已删除或等待中的实验室不能重复发起删除', () => {
    expect(() => scheduleLabDeletion('DELETED', now)).toThrow('LAB_NOT_SCHEDULABLE');
    expect(() => scheduleLabDeletion('PENDING_DELETION', now)).toThrow('LAB_NOT_SCHEDULABLE');
  });
});
