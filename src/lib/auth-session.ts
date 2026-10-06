import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AUTH_COOKIE, authCookieOptions } from '@/lib/auth';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createAuthSession(input: {
  userId: string;
  request?: NextRequest;
}): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const ip = input.request?.headers.get('x-real-ip') || input.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  await prisma.authSession.create({
    data: {
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ipHash: ip ? createHash('sha256').update(ip).digest('hex') : null,
      userAgent: input.request?.headers.get('user-agent')?.slice(0, 500) || null,
    },
  });
  return token;
}

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(AUTH_COOKIE, token, authCookieOptions(SESSION_TTL_MS / 1000));
  return response;
}

export async function revokeRequestSession(request: NextRequest): Promise<void> {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return;
  await prisma.authSession.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function resolveSession(request: NextRequest) {
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.authSession.findFirst({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        include: {
          labMemberships: {
            where: { status: 'ACTIVE' },
            include: { lab: { select: { id: true, name: true, status: true } } },
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });
  if (!session || session.user.status === 'RETIRED') return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    void prisma.authSession
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch((error) => console.error('[auth-session] 更新 lastSeenAt 失败:', error));
  }
  return session;
}
