import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/reservations
 * 管理员查询所有预约（支持 status/deviceId/userId 筛选）
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  // 跨实验室数据隔离：必须有关联实验室
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室，无法查询预约' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const deviceId = searchParams.get('deviceId');
  const userId = searchParams.get('userId');

  const where: Record<string, unknown> = {
    device: { labId: authResult.labId },
  };
  if (status) where.status = status;
  if (deviceId) where.deviceId = deviceId;
  if (userId) where.userId = userId;

  const reservations = await prisma.deviceReservation.findMany({
    where,
    include: {
      device: { select: { id: true, name: true, model: true, location: true, riskLevel: true } },
      user: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ data: reservations });
});
