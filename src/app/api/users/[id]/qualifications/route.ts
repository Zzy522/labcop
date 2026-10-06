import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/users/[id]/qualifications
 * 获取用户的所有资质记录
 * - 管理员可查看任意用户
 * - 实验员只能查看自己的
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;

  // 实验员只能查看自己的资质
  if (authResult.role !== 'ADMIN' && id !== authResult.userId) {
    return NextResponse.json({ error: '无权查看他人资质' }, { status: 403 });
  }
  if (id !== authResult.userId) {
    const sameLab = await prisma.labMembership.findFirst({
      where: { userId: id, labId: authResult.labId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!sameLab) return NextResponse.json({ error: '无权查看其他实验室用户的资质' }, { status: 403 });
  }

  const userQualifications = await prisma.userQualification.findMany({
    where: {
      userId: id,
      qualification: { OR: [{ labId: authResult.labId }, { scope: 'PLATFORM' }] },
    },
    include: {
      qualification: true,
    },
    orderBy: { grantedAt: 'desc' },
  });

  // 标记已过期但状态未更新的
  const now = new Date();
  const data = userQualifications.map((uq) => {
    const isExpired = uq.status === 'VALID' && uq.expireAt < now;
    return {
      ...uq,
      status: isExpired ? 'EXPIRED' : uq.status,
      isExpired,
    };
  });

  return NextResponse.json({ data });
});
