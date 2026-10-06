import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { capturePolicy } from '@/lib/agent/diagnostics';
import { withErrorHandler } from '@/lib/api-utils';
export const GET = withErrorHandler(async (request: NextRequest) => {
 const auth = await requireAuth(request); if (!isUserContext(auth)) return auth;
 return NextResponse.json(await capturePolicy(auth.labId ?? ''), { headers: { 'Cache-Control': 'no-store' } });
});
