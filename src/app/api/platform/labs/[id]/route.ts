import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler } from '@/lib/api-utils';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { verifyPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { platformAuditData } from '@/lib/platform-audit';
import {
  cancelRequestedLabDeletion,
  finalizeLabDeletion,
  requestLabDeletion,
} from '@/lib/lab-lifecycle-service';

const statusSchema = z.object({
  action: z.enum(['SUSPEND', 'RESTORE', 'CANCEL_DELETE']),
  password: z.string().min(1).max(200),
  reason: z.string().trim().min(1).max(500),
});

const deleteSchema = z.object({
  mode: z.enum(['SCHEDULE', 'IMMEDIATE']),
  password: z.string().min(1).max(200),
});

async function confirmOperatorPassword(userId: string, password: string) {
  const limit = checkRateLimit(`platform:lab-lifecycle:${userId}`, { capacity: 8, refillPerSec: 1 / 60 });
  if (!limit.allowed) return { ok: false as const, status: 429, error: '密码确认尝试过于频繁，请稍后再试' };
  const operator = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  if (!operator || !(await verifyPassword(password, operator.password))) {
    return { ok: false as const, status: 403, error: '当前平台管理员密码不正确' };
  }
  return { ok: true as const };
}

function lifecycleError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  const errors: Record<string, { message: string; status: number }> = {
    LAB_NOT_FOUND: { message: '实验室不存在', status: 404 },
    LAB_NOT_SCHEDULABLE: { message: '当前实验室状态不能进入删除等待期', status: 409 },
    LAB_NOT_PENDING_DELETION: { message: '实验室未处于删除等待期', status: 409 },
    LAB_DELETION_WAITING: { message: '7 天等待期尚未结束；如需提前完成，请再次选择“立即删除”', status: 409 },
  };
  return errors[code] ?? null;
}

export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const parsed = statusSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '操作参数无效' }, { status: 400 });
  const password = await confirmOperatorPassword(auth.userId, parsed.data.password);
  if (!password.ok) return NextResponse.json({ error: password.error }, { status: password.status });
  const { id } = await params;

  try {
    if (parsed.data.action === 'CANCEL_DELETE') {
      const lab = await cancelRequestedLabDeletion(id, auth.userId);
      return NextResponse.json({ data: lab, message: '已取消删除，实验室恢复到删除前状态' });
    }

    const lab = await prisma.lab.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!lab) return NextResponse.json({ error: '实验室不存在' }, { status: 404 });
    const expected = parsed.data.action === 'SUSPEND' ? 'ACTIVE' : lab.status === 'DELETED' ? 'DELETED' : 'SUSPENDED';
    if (lab.status !== expected) {
      return NextResponse.json({ error: `只有 ${expected} 状态的实验室可执行此操作` }, { status: 409 });
    }
    const nextStatus = parsed.data.action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE';
    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.lab.updateMany({ where: { id, status: expected }, data: { status: nextStatus, deletedAt: null } });
      if (claimed.count !== 1) throw new Error('LAB_STATUS_CHANGED');
      await tx.platformAuditLog.create({
        data: platformAuditData({
          operatorId: auth.userId,
          action: parsed.data.action === 'SUSPEND' ? 'SUSPEND_LAB' : 'RESTORE_LAB',
          targetType: 'LAB',
          targetId: id,
          before: { status: expected },
          after: { status: nextStatus },
          note: parsed.data.reason,
        }),
      });
      return tx.lab.findUniqueOrThrow({ where: { id } });
    });
    return NextResponse.json({
      data: updated,
      message: parsed.data.action === 'SUSPEND' ? '实验室已停用，成员将无法继续访问' : '实验室已恢复运行',
    });
  } catch (error) {
    const mapped = lifecycleError(error);
    if (mapped) return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    throw error;
  }
});

export const DELETE = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const parsed = deleteSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '删除参数无效' }, { status: 400 });
  const password = await confirmOperatorPassword(auth.userId, parsed.data.password);
  if (!password.ok) return NextResponse.json({ error: password.error }, { status: password.status });
  const { id } = await params;

  try {
    if (parsed.data.mode === 'SCHEDULE') {
      const lab = await requestLabDeletion(id, auth.userId);
      return NextResponse.json({
        data: lab,
        message: `已进入 7 天删除等待期，将于 ${lab.deletionScheduledAt?.toLocaleString('zh-CN')} 自动归档（数据保留，可恢复）`,
      });
    }
    const result = await finalizeLabDeletion(id, auth.userId, { immediate: true });
    return NextResponse.json({ data: result.lab, message: '实验室已归档，数据保留，可在列表恢复' });
  } catch (error) {
    const mapped = lifecycleError(error);
    if (mapped) return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    throw error;
  }
});
