import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { resetPasswordSchema } from '@/lib/validations/auth';
import { hashToken } from '@/lib/auth-tokens';
import { hashPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/auth-rate-limit';

/**
 * POST /api/auth/reset-password
 * 校验重置令牌并设置新密码。
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`auth:reset:ip:${ip}`, { capacity: 5, refillPerSec: 0.1 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `请求过于频繁，请 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后重试` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const body = await request.json();
  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: '输入校验失败', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const tokenHash = hashToken(parsed.data.token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.expiresAt < new Date()) {
    return NextResponse.json(
      { error: '重置链接无效或已过期，请重新申请' },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(parsed.data.password);

  const consumed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.passwordResetToken.deleteMany({
      where: { id: record.id, expiresAt: { gt: new Date() } },
    });
    if (deleted.count !== 1) return false;
    await tx.user.update({
      where: { id: record.userId },
      data: { password: passwordHash },
    });
    await tx.authSession.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return true;
  });
  if (!consumed) {
    return NextResponse.json({ error: '重置链接已被使用，请重新申请' }, { status: 400 });
  }

  return NextResponse.json({ data: { reset: true } });
});
