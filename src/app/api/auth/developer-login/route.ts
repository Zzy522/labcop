import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler, apiError } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp, isLocked, recordFailedLogin, resetLogin } from '@/lib/auth-rate-limit';
import { createAuthSession, setSessionCookie } from '@/lib/auth-session';

const schema = z.object({
  email: z.string().email('请输入有效邮箱').transform((value) => value.toLowerCase()),
  password: z.string().min(1, '请输入密码'),
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const ip = getClientIp(request);
  const ipLimit = checkRateLimit(`auth:developer-login:ip:${ip}`, { capacity: 6, refillPerSec: 0.1 });
  if (!ipLimit.allowed) return NextResponse.json({ error: '请求过于频繁，请稍后重试' }, { status: 429 });

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? '输入校验失败' }, { status: 400 });
  const { email, password } = parsed.data;
  const lockKey = `developer:${email}`;
  if (isLocked(lockKey).locked) return NextResponse.json({ error: '开发者账号已临时锁定，请稍后重试' }, { status: 423 });

  const user = await prisma.user.findFirst({
    where: { email: { equals: email }, platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE' },
  });
  if (!user || !(await verifyPassword(password, user.password))) {
    const failed = recordFailedLogin(lockKey);
    return apiError(failed.locked ? '凭证错误次数过多，账号已临时锁定' : `开发者凭证错误，还剩 ${failed.remaining} 次尝试机会`, failed.locked ? 423 : 401);
  }
  resetLogin(lockKey);

  const token = await createAuthSession({ userId: user.id, request });
  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: 'MEMBER',
      labRole: null,
      platformRole: 'PLATFORM_ADMIN',
      status: user.status,
      labId: null,
      labName: null,
      emailVerified: user.emailVerified?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
  });
  return setSessionCookie(response, token);
});
