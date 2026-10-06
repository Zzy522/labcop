import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const labs = await prisma.lab.findMany({
    include: { collegeOrganization: { select: { id: true, schoolName: true, name: true } }, owner: { select: { id: true, name: true, email: true } }, _count: { select: { memberships: true, devices: true, reagents: true } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200,
  });
  return NextResponse.json({ data: labs });
});
