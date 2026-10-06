import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { resolveSession } from '@/lib/auth-session';
import { prisma } from '@/lib/prisma';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const session = await resolveSession(request);
  if (!session) return NextResponse.json({ error: '申请会话已过期，请登录后查看' }, { status: 401 });

  const application = await prisma.registrationApplication.findFirst({
    where: { userId: session.userId },
    include: { targetLab: { select: { name: true } } },
    orderBy: { submittedAt: 'desc' },
  });
  return NextResponse.json({
    data: {
      userStatus: session.user.status,
      application: application ? {
        id: application.id,
        type: application.applicationType,
        status: application.status,
        requestedRole: application.requestedLabRole,
        labName: application.targetLab?.name ?? application.requestedLabName,
        reviewComment: application.reviewComment,
        submittedAt: application.submittedAt.toISOString(),
        reviewedAt: application.reviewedAt?.toISOString() ?? null,
      } : null,
    },
  });
});
