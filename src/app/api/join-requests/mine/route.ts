import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, parsePagination, paginatedResponse } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/join-requests/mine
 * 实验员查看自己提交的所有入组申请（按时间倒序）。
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip } = parsePagination(searchParams, 20, 50);

  const [total, list] = await Promise.all([
    prisma.joinRequest.count({ where: { userId: authResult.userId } }),
    prisma.joinRequest.findMany({
      where: { userId: authResult.userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        lab: { select: { id: true, name: true, location: true } },
      },
    }),
  ]);

  return NextResponse.json(
    paginatedResponse(
      list.map((r) => ({
        id: r.id,
        labId: r.labId,
        labName: r.lab.name,
        labLocation: r.lab.location,
        status: r.status,
        message: r.message,
        rejectReason: r.rejectReason,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize
    )
  );
});
