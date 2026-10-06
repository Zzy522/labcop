import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandler } from '@/lib/api-utils';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { retireMember } from '@/lib/member-retirement';

export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  
  const parsed = z.object({ reason: z.string().trim().min(1).max(500), confirm: z.literal(true) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请确认删除并填写原因（最多 500 字）' }, { status: 400 });
  return NextResponse.json(await retireMember(auth.userId, (await params).id, parsed.data.reason));
});
