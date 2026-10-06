import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import { AppError, ErrorCategory } from '@/lib/errors';

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get('Idempotency-Key');
  if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    throw new AppError(ErrorCategory.VALIDATION_ERROR, '缺少有效操作编号，请刷新页面后重试');
  }
  return key;
}

export function requestDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Claim, business writes and cached response commit together. A failed operation leaves no claim.
export async function idempotentTransaction<T>(
  scope: { labId: string; userId: string; operation: string; key: string; digest: string },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const identity = { labId: scope.labId, userId: scope.userId, operation: scope.operation, key: scope.key };
  const where = { labId_userId_operation_key: identity };
  const replay = (entry: { digest: string; response: string | null }): T => {
    if (entry.digest !== scope.digest) throw new AppError(ErrorCategory.BUSINESS_CONFLICT, '操作编号已用于其他内容，请重新发起操作');
    if (!entry.response) throw new AppError(ErrorCategory.BUSINESS_CONFLICT, '操作正在处理，请使用同一操作编号重试');
    return JSON.parse(entry.response) as T;
  };
  const existing = await prisma.businessOperation.findUnique({ where });
  if (existing) return replay(existing);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.businessOperation.create({ data: { ...identity, digest: scope.digest } });
      const result = await work(tx);
      await tx.businessOperation.update({ where, data: { response: JSON.stringify(result) } });
      return result;
    });
  } catch (error) {
    // Concurrent duplicate: only replay a committed result, never run business writes twice.
    const committed = await prisma.businessOperation.findUnique({ where });
    if (committed) return replay(committed);
    throw error;
  }
}
