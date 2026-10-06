import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { isUserContext, requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  const notifications = await prisma.notification.findMany({
    where: { recipientId: auth.userId, type: { in: ['SYSTEM', 'SYSTEM_MAINTENANCE'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ data: notifications });
});
