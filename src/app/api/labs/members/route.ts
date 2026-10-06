import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/labs/members
 * 获取当前用户所在实验室的成员列表（用于巡检派发等场景）
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ data: [] });
  }

  const members = await prisma.user.findMany({
    where: { status: 'ACTIVE', labMemberships: { some: { labId: authResult.labId, status: 'ACTIVE' } } },
    select: {
      id: true,
      name: true,
      role: true,
      email: true,
      labMemberships: { where: { labId: authResult.labId, status: 'ACTIVE' }, select: { role: true } },
    },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ data: members.map((member) => ({ ...member, labRole: member.labMemberships[0]?.role, labMemberships: undefined })) });
});
