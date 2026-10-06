import { queueAudit } from '@/lib/audit-outbox';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'STATUS_CHANGE'
  | 'SCRAP'
  | 'GRANT'
  | 'REVOKE';

type TargetType =
  | 'DEVICE'
  | 'REAGENT'
  | 'USER'
  | 'QUALIFICATION'
  | 'RESERVATION'
  | 'INSPECTION'
  | 'COMPOUND';

interface AuditLogInput {
  operatorId: string;
  action: AuditAction;
  targetType: TargetType;
  targetId: string;
  targetName?: string;
  beforeData?: unknown;
  afterData?: unknown;
  note?: string;
  /** 显式传入 labId，避免查询 User 表 */
  labId?: string;
}

/**
 * 写入审计日志。所有关键变更（设备/试剂/人员/资质）都应调用此函数。
 * 事务内失败会回滚；旧调用方失败时写入持久重放队列。
 *
 * 数据隔离：自动从 operatorId 查询 labId 并写入 AuditLog.labId。
 * 调用方也可显式传入 labId 以避免额外查询。
 */
export async function logAudit(input: AuditLogInput, client: Prisma.TransactionClient = prisma): Promise<void> {
  const data = {
    id: crypto.randomUUID(), createdAt: new Date(), operatorId: input.operatorId, action: input.action,
    targetType: input.targetType, targetId: input.targetId, targetName: input.targetName ?? null,
    beforeData: input.beforeData ? JSON.stringify(input.beforeData) : null,
    afterData: input.afterData ? JSON.stringify(input.afterData) : null,
    note: input.note ?? null, labId: input.labId ?? null,
  };
  try {
    if (!data.labId) {
      const membership = await client.labMembership.findFirst({
        where: { userId: input.operatorId, status: 'ACTIVE', isPrimary: true }, select: { labId: true },
      });
      data.labId = membership?.labId ?? null;
    }
    await client.auditLog.create({ data });
  } catch (error) {
    if (client !== prisma) throw error;
    console.error('[AuditLog] 数据库写入失败，持久保存至审计重放队列', error);
    await queueAudit(data);
  }
}
