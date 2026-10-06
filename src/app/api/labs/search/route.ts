import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/labs/search?q=xxx
 * 公开接口（proxy 放行），供注册页按名称查找实验室。
 * 脱敏返回：仅 id/name/location/memberCount，不泄露成员详情与 joinCode。
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();

  if (!q || q.length < 1) {
    return NextResponse.json({ data: [] });
  }

  const labs = await prisma.lab.findMany({
    where: { name: { contains: q } },
    select: {
      id: true,
      name: true,
      location: true,
      _count: { select: { users: true } },
    },
    take: 10,
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({
    data: labs.map((l) => ({
      id: l.id,
      name: l.name,
      location: l.location,
      memberCount: l._count.users,
    })),
  });
});
