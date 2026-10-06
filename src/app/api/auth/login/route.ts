import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, apiError } from '@/lib/api-utils';
import { loginSchema } from '@/lib/validations/auth';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { isLocked, recordFailedLogin, resetLogin, getClientIp } from '@/lib/auth-rate-limit';
import { createAuthSession, setSessionCookie } from '@/lib/auth-session';

export const POST = withErrorHandler(async (request: NextRequest) => {
  const ip = getClientIp(request);
  const ipLimit = checkRateLimit(`auth:login:ip:${ip}`, { capacity: 12, refillPerSec: 0.2 });
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: '请求过于频繁，请稍后重试' }, { status: 429 });
  }
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '输入校验失败' }, { status: 400 });

  const { email, password } = parsed.data;
  const lock = isLocked(email);
  if (lock.locked) return NextResponse.json({ error: '账号已临时锁定，请稍后重试' }, { status: 423 });

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      labMemberships: {
        where: { status: 'ACTIVE' },
        include: { lab: { select: { id: true, name: true, status: true } } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
      registrationApplications: { orderBy: { submittedAt: 'desc' }, take: 1 },
    },
  });
  if (!user || !(await verifyPassword(password, user.password))) {
    const failed = recordFailedLogin(email);
    return apiError(failed.locked ? '密码错误次数过多，账号已临时锁定' : `邮箱或密码错误，还剩 ${failed.remaining} 次尝试机会`, failed.locked ? 423 : 401);
  }
  resetLogin(email);

  if (['SUSPENDED', 'DISABLED', 'RETIRED'].includes(user.status)) {
    return NextResponse.json({ error: '账号已停用，请联系管理员', status: user.status }, { status: 403 });
  }

  const token = await createAuthSession({ userId: user.id, request });
  if (user.status !== 'ACTIVE') {
    const application = user.registrationApplications[0];
    const response = NextResponse.json({
      pendingApproval: user.status === 'PENDING_APPROVAL',
      status: user.status,
      application: application ? {
        id: application.id,
        type: application.applicationType,
        status: application.status,
        reviewComment: application.reviewComment,
        submittedAt: application.submittedAt.toISOString(),
      } : null,
    }, { status: 202 });
    return setSessionCookie(response, token);
  }

  const membership = user.labMemberships.find((item) => item.lab.status === 'ACTIVE');
  const labRole = membership?.role ?? null;
  const response = NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: labRole === 'LAB_OWNER' || labRole === 'LAB_ADMIN' ? 'ADMIN' : 'MEMBER',
      labRole,
      platformRole: user.platformRole,
      status: user.status,
      labId: membership?.labId ?? null,
      labName: membership?.lab.name ?? null,
      emailVerified: user.emailVerified?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    },
  });
  return setSessionCookie(response, token);
});
