import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { verifyEmailSchema } from '@/lib/validations/auth';
import { hashToken } from '@/lib/auth-tokens';

/**
 * POST /api/auth/verify-email
 * 校验邮箱验证令牌，标记邮箱已验证。
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '验证令牌无效' }, { status: 400 });
  }

  const tokenHash = hashToken(parsed.data.token);
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.expiresAt < new Date()) {
    return NextResponse.json(
      { error: '验证链接无效或已过期，请重新发送验证邮件' },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: new Date() },
    }),
    prisma.emailVerificationToken.delete({ where: { id: record.id } }),
  ]);

  return NextResponse.json({ data: { verified: true } });
});
