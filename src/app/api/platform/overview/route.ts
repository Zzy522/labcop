import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const [users, activeUsers, labs, colleges, pendingLabs, pendingJoins, recentAudit] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.lab.count({ where: { status: 'ACTIVE' } }),
    prisma.college.count({ where: { status: 'ACTIVE' } }),
    prisma.registrationApplication.count({ where: { applicationType: 'CREATE_LAB', status: 'PENDING' } }),
    prisma.registrationApplication.count({ where: { applicationType: 'JOIN_LAB', status: 'PENDING' } }),
    prisma.platformAuditLog.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      include: { operator: { select: { name: true, email: true } } },
    }),
  ]);
  return NextResponse.json({ data: { users, activeUsers, labs, colleges, pendingLabs, pendingJoins, recentAudit } });
});
