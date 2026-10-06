import type { Prisma } from '@/generated/prisma/client';

export function platformAuditData(input: {
  operatorId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  note?: string | null;
}): Prisma.PlatformAuditLogUncheckedCreateInput {
  return {
    operatorId: input.operatorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    beforeData: input.before === undefined ? null : JSON.stringify(input.before),
    afterData: input.after === undefined ? null : JSON.stringify(input.after),
    note: input.note || null,
  };
}
