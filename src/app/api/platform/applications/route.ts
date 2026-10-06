import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { decryptPersonalData } from '@/lib/crypto';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const status = request.nextUrl.searchParams.get('status') || 'PENDING';
  const applications = await prisma.registrationApplication.findMany({
    where: status === 'ALL' ? undefined : { status },
    include: {
      applicant: { select: { id: true, name: true, email: true, phoneEncrypted: true, institutionType: true, schoolName: true, collegeName: true, academicIdentity: true, companyName: true, companyIdentity: true, status: true } },
      targetLab: { select: { id: true, name: true, location: true, status: true } },
      reviewer: { select: { name: true } },
    },
    orderBy: { submittedAt: 'desc' },
    take: 100,
  });
  return NextResponse.json({ data: applications.map((item) => ({
    ...item,
    applicant: { ...item.applicant, phone: item.applicant.phoneEncrypted ? decryptPersonalData(item.applicant.phoneEncrypted) : null, phoneEncrypted: undefined },
  })) });
});
