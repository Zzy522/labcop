import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { resolveSession } from '@/lib/auth-session';

/** Browser storage is only a cache; the HttpOnly session is the authority. */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await resolveSession(request);
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!session || ['SUSPENDED', 'DISABLED', 'RETIRED'].includes(session.user.status)) {
    return NextResponse.json({ user: null }, { status: 401, headers });
  }
  const { user } = session;
  const membership = user.labMemberships.find(item => item.lab.status === 'ACTIVE');
  const labRole = membership?.role ?? null;
  return NextResponse.json({ user: {
    id: user.id, name: user.name, email: user.email,
    role: labRole === 'LAB_OWNER' || labRole === 'LAB_ADMIN' ? 'ADMIN' : 'MEMBER',
    labRole, platformRole: user.platformRole, status: user.status,
    labId: membership?.labId ?? null, labName: membership?.lab.name ?? null,
    emailVerified: user.emailVerified?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(),
  } }, { headers });
});
