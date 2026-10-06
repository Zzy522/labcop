import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireLabOwner, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { revokeAllUserSessions } from '@/lib/auth-session';
import { z } from 'zod';
import { canReviewApplication } from '@/lib/organization-authz';

const schema = z.object({ action: z.enum(['APPROVE', 'REJECT']), comment: z.string().trim().max(500).optional() });

export const POST = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireLabOwner(request);
  if (!isUserContext(auth)) return auth;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '审批参数无效' }, { status: 400 });
  const { id } = await params;
  const application = await prisma.registrationApplication.findFirst({
    where: { id, applicationType: 'JOIN_LAB', targetLabId: auth.labId, status: 'PENDING' },
  });
  if (!application) return NextResponse.json({ error: '申请不存在、已处理或不属于本实验室' }, { status: 404 });
  if (!canReviewApplication(auth, application)) return NextResponse.json({ error: '只有本实验室 LAB_OWNER 可以审批' }, { status: 403 });

  if (parsed.data.action === 'REJECT') {
    await prisma.$transaction([
      prisma.registrationApplication.update({ where: { id }, data: { status: 'REJECTED', reviewerId: auth.userId, reviewComment: parsed.data.comment || null, reviewedAt: new Date() } }),
      prisma.user.update({ where: { id: application.userId, status: { not: 'RETIRED' } }, data: { status: 'REJECTED', statusReason: parsed.data.comment || null, statusChangedAt: new Date() } }),
    ]);
    await revokeAllUserSessions(application.userId);
    return NextResponse.json({ message: '申请已拒绝' });
  }

  await prisma.$transaction(async (tx) => {
    const claim = await tx.registrationApplication.updateMany({ where: { id, status: 'PENDING', targetLabId: auth.labId }, data: { status: 'REVIEWING' } });
    if (claim.count !== 1) throw new Error('APPLICATION_ALREADY_REVIEWED');
    await tx.labMembership.upsert({
      where: { labId_userId: { labId: auth.labId!, userId: application.userId } },
      create: { labId: auth.labId!, userId: application.userId, role: application.requestedLabRole, status: 'ACTIVE', isPrimary: true, approvedById: auth.userId, approvedAt: new Date() },
      update: { role: application.requestedLabRole, status: 'ACTIVE', isPrimary: true, approvedById: auth.userId, approvedAt: new Date() },
    });
    await tx.user.update({ where: { id: application.userId, status: { not: 'RETIRED' } }, data: { status: 'ACTIVE', role: application.requestedLabRole === 'LAB_MEMBER' ? 'MEMBER' : 'ADMIN', labId: auth.labId, statusReason: null, statusChangedAt: new Date() } });
    await tx.registrationApplication.update({ where: { id }, data: { status: 'APPROVED', reviewerId: auth.userId, reviewComment: parsed.data.comment || null, reviewedAt: new Date() } });
    await tx.auditLog.create({ data: { labId: auth.labId!, operatorId: auth.userId, action: 'APPROVE', targetType: 'REGISTRATION_APPLICATION', targetId: id, afterData: JSON.stringify({ userId: application.userId, role: application.requestedLabRole }), note: parsed.data.comment || null } });
  });
  await revokeAllUserSessions(application.userId);
  return NextResponse.json({ message: '账号申请已批准并加入实验室' });
});
