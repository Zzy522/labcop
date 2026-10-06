import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { generateJoinCode } from '@/lib/join-code';
import { platformAuditData } from '@/lib/platform-audit';
import { revokeAllUserSessions } from '@/lib/auth-session';
import { z } from 'zod';
import { canReviewApplication } from '@/lib/organization-authz';
import { Errors } from '@/lib/errors';

const reviewSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT', 'NEEDS_INFO']),
  comment: z.string().trim().max(500).optional(),
});

export const POST = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const parsed = reviewSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '审批参数无效' }, { status: 400 });
  const { id } = await params;

  const existing = await prisma.registrationApplication.findFirst({
    where: { id, applicationType: { in: ['CREATE_LAB', 'JOIN_LAB'] }, status: 'PENDING' },
    include: { applicant: true, targetLab: { select: { id: true, name: true, status: true } } },
  });
  if (!existing) return NextResponse.json({ error: '申请不存在或已处理' }, { status: 404 });
  if (!canReviewApplication(auth, existing)) return NextResponse.json({ error: '无权审批此类申请' }, { status: 403 });

  if (parsed.data.action !== 'APPROVE') {
    const nextStatus = parsed.data.action === 'REJECT' ? 'REJECTED' : 'NEEDS_INFO';
    await prisma.$transaction([
      prisma.registrationApplication.update({ where: { id }, data: { status: nextStatus, reviewerId: auth.userId, reviewComment: parsed.data.comment || null, reviewedAt: new Date() } }),
      prisma.user.update({ where: { id: existing.userId, status: { not: 'RETIRED' } }, data: { status: nextStatus === 'REJECTED' ? 'REJECTED' : 'PENDING_APPROVAL', statusReason: parsed.data.comment || null, statusChangedAt: new Date() } }),
      prisma.platformAuditLog.create({ data: platformAuditData({ operatorId: auth.userId, action: nextStatus, targetType: 'REGISTRATION_APPLICATION', targetId: id, before: { status: 'PENDING' }, after: { status: nextStatus }, note: parsed.data.comment }) }),
    ]);
    await revokeAllUserSessions(existing.userId);
    return NextResponse.json({ message: nextStatus === 'REJECTED' ? '申请已拒绝' : '已要求补充材料' });
  }

  if (existing.applicationType === 'JOIN_LAB') {
    if (!existing.targetLabId || !existing.targetLab || existing.targetLab.status !== 'ACTIVE') {
      return NextResponse.json({ error: '目标实验室不存在或已停用，不能批准该申请' }, { status: 409 });
    }
    const result = await prisma.$transaction(async (tx) => {
      const claim = await tx.registrationApplication.updateMany({
        where: { id, status: 'PENDING', applicationType: 'JOIN_LAB' },
        data: { status: 'REVIEWING' },
      });
      if (claim.count !== 1) throw Errors.businessConflict('申请已被其他审批人处理，请刷新后查看');
      const existingMembership = await tx.labMembership.findFirst({
        where: { userId: existing.userId, status: 'ACTIVE', labId: { not: existing.targetLabId! } },
        select: { lab: { select: { name: true } } },
      });
      if (existingMembership) throw Errors.businessConflict(`申请人已加入实验室「${existingMembership.lab.name}」，不能重复批准`);
      await tx.labMembership.upsert({
        where: { labId_userId: { labId: existing.targetLabId!, userId: existing.userId } },
        create: {
          labId: existing.targetLabId!,
          userId: existing.userId,
          role: existing.requestedLabRole,
          status: 'ACTIVE',
          isPrimary: true,
          approvedById: auth.userId,
          approvedAt: new Date(),
        },
        update: {
          role: existing.requestedLabRole,
          status: 'ACTIVE',
          isPrimary: true,
          approvedById: auth.userId,
          approvedAt: new Date(),
        },
      });
      await tx.user.update({
        where: { id: existing.userId, status: { not: 'RETIRED' } },
        data: {
          status: 'ACTIVE',
          role: existing.requestedLabRole === 'LAB_MEMBER' ? 'MEMBER' : 'ADMIN',
          labId: existing.targetLabId,
          statusReason: null,
          statusChangedAt: new Date(),
        },
      });
      await tx.registrationApplication.update({
        where: { id },
        data: { status: 'APPROVED', reviewerId: auth.userId, reviewComment: parsed.data.comment || null, reviewedAt: new Date() },
      });
      await tx.platformAuditLog.create({
        data: platformAuditData({
          operatorId: auth.userId,
          action: 'APPROVE_JOIN_LAB',
          targetType: 'REGISTRATION_APPLICATION',
          targetId: id,
          before: { status: 'PENDING' },
          after: { status: 'APPROVED', labId: existing.targetLabId, role: existing.requestedLabRole },
          note: parsed.data.comment,
        }),
      });
      return { labId: existing.targetLabId!, labName: existing.targetLab!.name, role: existing.requestedLabRole };
    });
    await revokeAllUserSessions(existing.userId);
    return NextResponse.json({ data: result, message: '账号申请已批准并加入实验室' });
  }

  const joinCode = generateJoinCode();
  const result = await prisma.$transaction(async (tx) => {
    const claim = await tx.registrationApplication.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REVIEWING' } });
    if (claim.count !== 1) throw new Error('APPLICATION_ALREADY_REVIEWED');
    let collegeId: string | null = null;
    if (existing.schoolName && existing.collegeName) {
      const college = await tx.college.upsert({
        where: { schoolName_name: { schoolName: existing.schoolName, name: existing.collegeName } },
        create: { schoolName: existing.schoolName, name: existing.collegeName },
        update: { status: 'ACTIVE' },
      });
      collegeId = college.id;
    }
    const lab = await tx.lab.create({
      data: {
        name: existing.requestedLabName || '未命名实验室',
        location: existing.requestedLocation || '待补充',
        school: existing.schoolName,
        college: existing.collegeName,
        collegeId,
        joinCode,
        ownerId: existing.userId,
        status: 'ACTIVE',
      },
    });
    await tx.labMembership.create({ data: { labId: lab.id, userId: existing.userId, role: 'LAB_OWNER', status: 'ACTIVE', isPrimary: true, approvedById: auth.userId, approvedAt: new Date() } });
    await tx.user.update({ where: { id: existing.userId, status: { not: 'RETIRED' } }, data: { status: 'ACTIVE', role: 'ADMIN', labId: lab.id, statusReason: null, statusChangedAt: new Date() } });
    await tx.registrationApplication.update({ where: { id }, data: { status: 'APPROVED', reviewerId: auth.userId, reviewComment: parsed.data.comment || null, reviewedAt: new Date(), targetLabId: lab.id } });
    await tx.platformAuditLog.create({ data: platformAuditData({ operatorId: auth.userId, action: 'APPROVE', targetType: 'REGISTRATION_APPLICATION', targetId: id, before: { status: 'PENDING' }, after: { status: 'APPROVED', labId: lab.id }, note: parsed.data.comment }) });
    return lab;
  });
  await revokeAllUserSessions(existing.userId);
  return NextResponse.json({ data: { labId: result.id, labName: result.name }, message: '实验室及首位实验室负责人已批准' });
});
