import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const q = request.nextUrl.searchParams.get('q')?.trim();
  const users = await prisma.user.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : undefined,
    select: { id: true, name: true, email: true, platformRole: true, status: true, createdAt: true, labMemberships: { where: { status: 'ACTIVE' }, select: { role: true, lab: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: 'desc' }, take: 200,
  });
  return NextResponse.json({ data: users });
});
