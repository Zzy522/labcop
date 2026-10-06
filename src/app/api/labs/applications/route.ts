import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireLabOwner, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { decryptPersonalData } from '@/lib/crypto';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = await requireLabOwner(request);
  if (!isUserContext(auth)) return auth;
  const applications = await prisma.registrationApplication.findMany({
    where: { applicationType: 'JOIN_LAB', targetLabId: auth.labId, status: request.nextUrl.searchParams.get('status') || 'PENDING' },
    include: { applicant: { select: { id: true, name: true, email: true, phoneEncrypted: true, institutionType: true, schoolName: true, collegeName: true, academicIdentity: true, companyName: true, companyIdentity: true } } },
    orderBy: { submittedAt: 'asc' },
  });
  return NextResponse.json({ data: applications.map((item) => ({ ...item, applicant: { ...item.applicant, phone: item.applicant.phoneEncrypted ? decryptPersonalData(item.applicant.phoneEncrypted) : null, phoneEncrypted: undefined } })) });
});
