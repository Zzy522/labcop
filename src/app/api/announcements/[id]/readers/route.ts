import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { listAnnouncementReaders } from '@/lib/services/announcement.service';

/**
 * GET /api/announcements/[id]/readers
 * 管理员查询通告已读人员名单 + 未读人员名单
 */
export const GET = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authResult = await requireAdmin(_request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const announcement = await prisma.announcement.findUnique({
    where: { id },
    select: { id: true, labId: true, title: true },
  });
  if (!announcement) {
    return NextResponse.json({ error: '通告不存在' }, { status: 404 });
  }
  if (authResult.labId && announcement.labId !== authResult.labId) {
    return NextResponse.json({ error: '无权访问' }, { status: 403 });
  }

  const readers = await listAnnouncementReaders(id);
  const readerIds = new Set(readers.map((r) => r.userId));

  // 查询本实验室所有成员
  const allMembers = await prisma.user.findMany({
    where: { labId: announcement.labId },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });

  const unread = allMembers
    .filter((m) => !readerIds.has(m.id))
    .map((m) => ({
      userId: m.id,
      userName: m.name,
      userEmail: m.email,
      role: m.role,
    }));

  return NextResponse.json({
    data: {
      announcementTitle: announcement.title,
      readers,
      unread,
      total: allMembers.length,
      readCount: readers.length,
      unreadCount: unread.length,
    },
  });
});
