import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/reservations/mine
 * 获取当前用户的预约列表（设备预约）
 * 支持 status 筛选
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');

  const where: Record<string, unknown> = { userId: authResult.userId };
  if (status) {
    where.status = status;
  }

  const reservations = await prisma.deviceReservation.findMany({
    where,
    include: {
      device: { select: { id: true, name: true, model: true, location: true, riskLevel: true } },
    },
    orderBy: { startTime: 'desc' },
  });

  return NextResponse.json({ data: reservations });
});
