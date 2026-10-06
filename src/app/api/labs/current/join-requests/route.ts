import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, parsePagination, paginatedResponse } from '@/lib/api-utils';
import { requireLabOwner, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/labs/current/join-requests?status=PENDING
 * 管理员查看本实验室的入组申请列表。
 *
 * - 默认返回 PENDING（待审批）
 * - ?status=all 返回全部（含历史）
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireLabOwner(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get('status') || 'PENDING';
  const { page, pageSize, skip } = parsePagination(searchParams, 20, 50);

  const where: { labId: string; status?: string } = { labId: authResult.labId };
  if (statusFilter !== 'all') {
    where.status = statusFilter;
  }

  const [total, list] = await Promise.all([
    prisma.joinRequest.count({ where }),
    prisma.joinRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return NextResponse.json(
    paginatedResponse(
      list.map((r) => ({
        id: r.id,
        userId: r.user.id,
        userName: r.user.name,
        userEmail: r.user.email,
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
