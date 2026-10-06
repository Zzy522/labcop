import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { emailSchema } from '@/lib/validations/auth';
import { generateToken, hashToken, TOKEN_TTL_MS } from '@/lib/auth-tokens';
import { sendPasswordResetEmail } from '@/lib/email';
import { checkDailyLimit, checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/auth-rate-limit';

/**
 * POST /api/auth/forgot-password
 * 发起密码重置：生成令牌并发送重置邮件。
 *
 * 防枚举：无论邮箱是否存在，统一返回成功。
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ip = getClientIp(request);
  const rl = checkRateLimit(`auth:forgot:ip:${ip}`, { capacity: 3, refillPerSec: 0.05 });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `请求过于频繁，请 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后重试` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
    );
  }

  const body = await request.json();
  const parsed = emailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
  }
  const email = parsed.data.email;
  const emailLimit = checkRateLimit(`auth:forgot:email:${email}`, { capacity: 1, refillPerSec: 1 / 300 });
  // 邮箱维度始终返回相同成功响应，避免通过限流状态枚举账号；被抑制时不发送邮件。
  if (!emailLimit.allowed) return NextResponse.json({ data: { sent: true } });
  const emailDaily = checkDailyLimit(`auth:forgot:email-daily:${email}`, 5);
  if (!emailDaily.allowed) return NextResponse.json({ data: { sent: true } });

  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    // 清理旧令牌，生成新令牌
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
    const token = generateToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
    await sendPasswordResetEmail(user.email, token).catch((e) =>
      console.error('[forgot-password] 邮件发送失败:', e)
    );
  }

  // 统一返回，防枚举
  return NextResponse.json({ data: { sent: true } });
});
