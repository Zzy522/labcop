import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { clearAuthCookie } from '@/lib/auth';
import { revokeRequestSession } from '@/lib/auth-session';

/** POST /api/auth/logout — 清除认证 Cookie */
export const POST = withErrorHandler(async (request: NextRequest) => {
  await revokeRequestSession(request);
  const res = NextResponse.json({ data: { loggedOut: true } });
  return clearAuthCookie(res);
});
