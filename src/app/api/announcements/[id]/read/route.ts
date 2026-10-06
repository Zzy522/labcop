import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { markAnnouncementRead } from '@/lib/services/announcement.service';

/** POST /api/announcements/[id]/read - 实验员标记通告已读（幂等） */
export const POST = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authResult = await requireAuth(_request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const announcement = await prisma.announcement.findUnique({
    where: { id },
    select: { id: true, labId: true, status: true },
  });
  if (!announcement) {
    return NextResponse.json({ error: '通告不存在' }, { status: 404 });
  }
  if (authResult.labId && announcement.labId !== authResult.labId) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  await markAnnouncementRead(id, authResult.userId);
  return NextResponse.json({ message: '已标记为已读' });
});
