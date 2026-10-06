import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { isUserContext, requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

export const POST = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  const { id } = await params;
  const updated = await prisma.notification.updateMany({
    where: { id, recipientId: auth.userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (!updated.count) return NextResponse.json({ error: '通知不存在或已读' }, { status: 404 });
  return NextResponse.json({ message: '已标记为已读' });
});
