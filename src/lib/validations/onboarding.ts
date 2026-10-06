import { z } from 'zod/v4';

export const onboardingUpdateSchema = z.object({
  guideKey: z.string().trim().regex(/^(ADMIN_QUICK|MEMBER_QUICK|MODULE_[A-Z0-9_]+)$/),
  guideVersion: z.number().int().min(1).max(100).default(1),
  action: z.enum(['START', 'PROGRESS', 'COMPLETE', 'DISMISS', 'RESTART', 'ENABLE_AUTO']),
  lastStep: z.number().int().min(0).max(50).optional(),
  doNotAutoPrompt: z.boolean().optional(),
});
