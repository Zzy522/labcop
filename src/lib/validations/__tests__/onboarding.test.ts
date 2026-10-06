import { describe, expect, it } from 'vitest';
import { onboardingUpdateSchema } from '../onboarding';

describe('onboarding progress validation', () => {
  it('accepts finite quick and module guide progress', () => {
    expect(onboardingUpdateSchema.safeParse({
      guideKey: 'ADMIN_QUICK',
      guideVersion: 1,
      action: 'PROGRESS',
      lastStep: 4,
    }).success).toBe(true);
    expect(onboardingUpdateSchema.safeParse({
      guideKey: 'MODULE_STOCK_IN',
      guideVersion: 1,
      action: 'COMPLETE',
      lastStep: 0,
    }).success).toBe(true);
  });

  it('rejects unknown guides and unbounded step values', () => {
    expect(onboardingUpdateSchema.safeParse({ guideKey: 'ADMIN_DELETE_ALL', guideVersion: 1, action: 'START' }).success).toBe(false);
    expect(onboardingUpdateSchema.safeParse({ guideKey: 'MEMBER_QUICK', guideVersion: 1, action: 'PROGRESS', lastStep: 51 }).success).toBe(false);
  });
});
