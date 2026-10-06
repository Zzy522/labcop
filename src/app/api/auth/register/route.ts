import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/validations/auth';
import { hashPassword, verifyEmailCode } from '@/lib/auth';
import { normalizeJoinCode, isValidJoinCodeFormat } from '@/lib/join-code';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/auth-rate-limit';
import { encryptPersonalData } from '@/lib/crypto';
import { createAuthSession, setSessionCookie } from '@/lib/auth-session';
import { publicRegistrationRole } from '@/lib/organization-authz';

async function resolveTargetLab(joinCode?: string, labId?: string) {
  if (joinCode) {
    const normalized = normalizeJoinCode(joinCode);
    if (!isValidJoinCodeFormat(normalized)) return null;
    return prisma.lab.findFirst({
      where: { joinCode: normalized, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
  }
  if (labId) {
    return prisma.lab.findFirst({
      where: { id: labId, status: 'ACTIVE' },
      select: { id: true, name: true },
    });
  }
  return null;
}

/** 公开注册只创建待审批申请；任何公开输入都不能产生平台或学院权限。 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ip = getClientIp(request);
  const ipLimit = checkRateLimit(`auth:register:ip:${ip}`, { capacity: 3, refillPerSec: 0.05 });
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: `注册请求过于频繁，请 ${Math.ceil(ipLimit.retryAfterMs / 1000)} 秒后重试` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) } },
    );
  }

  const parsed = registerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: '输入校验失败', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return NextResponse.json({ error: '该邮箱已注册，请直接登录查看申请状态' }, { status: 409 });

  const codeLimit = checkRateLimit(`auth:register:code:${data.email}`, { capacity: 5, refillPerSec: 0.02 });
  if (!codeLimit.allowed) {
    return NextResponse.json({ error: '验证码尝试过于频繁，请稍后重试' }, { status: 429 });
  }
  if (!verifyEmailCode(data.verifyToken, data.email, data.code)) {
    return NextResponse.json({ error: '邮箱验证码不正确或已过期，请重新获取' }, { status: 400 });
  }

  const createsLab = data.accountType === 'LAB_ADMIN' && !data.joinCode && !data.labId;
  const targetLab = createsLab ? null : await resolveTargetLab(data.joinCode, data.labId);
  if (!createsLab && !targetLab) {
    return NextResponse.json({ error: '实验室不存在、已停用或加入码无效' }, { status: 404 });
  }

  const requestedLabRole = publicRegistrationRole(data.accountType, createsLab);
  const passwordHash = await hashPassword(data.password);
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        password: passwordHash,
        emailVerified: new Date(),
        role: requestedLabRole === 'LAB_MEMBER' ? 'MEMBER' : 'ADMIN',
        platformRole: 'PLATFORM_USER',
        status: 'PENDING_APPROVAL',
        labId: null,
        phoneEncrypted: encryptPersonalData(data.phone),
        institutionType: data.institutionType,
        schoolName: data.institutionType === 'UNIVERSITY' ? data.schoolName : null,
        collegeName: data.institutionType === 'UNIVERSITY' ? data.collegeName : null,
        academicIdentity: data.institutionType === 'UNIVERSITY' ? data.academicIdentity : null,
        companyName: data.institutionType === 'ENTERPRISE' ? data.companyName : null,
        companyIdentity: data.institutionType === 'ENTERPRISE' ? data.companyIdentity : null,
        statusChangedAt: new Date(),
      },
    });
    const application = await tx.registrationApplication.create({
      data: {
        userId: user.id,
        applicationType: createsLab ? 'CREATE_LAB' : 'JOIN_LAB',
        targetLabId: targetLab?.id ?? null,
        requestedLabRole,
        requestedLabName: createsLab ? data.labName?.trim() : null,
        requestedLocation: createsLab ? data.labLocation?.trim() : null,
        schoolName: data.institutionType === 'UNIVERSITY' ? data.schoolName : null,
        collegeName: data.institutionType === 'UNIVERSITY' ? data.collegeName : null,
        formSnapshot: {
          message: data.message || null,
          institutionType: data.institutionType,
          academicIdentity: data.academicIdentity || null,
          companyName: data.companyName || null,
          companyIdentity: data.companyIdentity || null,
        },
      },
    });
    return { user, application };
  });

  const token = await createAuthSession({ userId: result.user.id, request });
  const response = NextResponse.json({
    application: {
      id: result.application.id,
      type: result.application.applicationType,
      status: result.application.status,
      targetLabName: targetLab?.name ?? data.labName,
      requestedRole: requestedLabRole,
      submittedAt: result.application.submittedAt.toISOString(),
    },
    pendingApproval: true,
    message: createsLab
      ? '申请已提交，将由平台管理员审批实验室及首位实验室负责人。'
      : '申请已提交，将由该实验室负责人审批。',
  }, { status: 202 });
  return setSessionCookie(response, token);
});
