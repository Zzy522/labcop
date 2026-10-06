import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { z } from 'zod';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const grantSchema = z.object({
  userId: z.string().min(1, '用户ID不能为空'),
  note: z.string().max(500).optional(),
});

/**
 * POST /api/qualifications/[id]/grant
 * 将资质授权给指定用户（仅管理员）
 * - 自动计算过期时间（基于资质模板的 validMonths）
 * - 如果已存在有效授权，返回提示
 */
export const POST = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const body = await request.json();
  const parsed = grantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  const { userId, note } = parsed.data;

  // 校验资质模板存在
  const qualification = await prisma.qualification.findFirst({
    where: { id, OR: [{ labId: authResult.labId }, { scope: 'PLATFORM' }] },
  });
  if (!qualification) {
    return NextResponse.json({ error: '资质模板不存在' }, { status: 404 });
  }

  // 校验用户存在
  const user = await prisma.user.findFirst({
    where: { id: userId, labMemberships: { some: { labId: authResult.labId, status: 'ACTIVE' } } },
  });
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  }

  // 检查是否已授权（且未过期/未撤销）
  const existing = await prisma.userQualification.findUnique({
    where: { userId_qualificationId: { userId, qualificationId: id } },
  });
  if (existing && existing.status === 'VALID') {
    return NextResponse.json({ error: '该用户已持有此资质（有效中）' }, { status: 400 });
  }

  // 计算过期时间
  const expireAt = new Date();
  expireAt.setMonth(expireAt.getMonth() + qualification.validMonths);

  // 创建或重新激活授权
  const userQualification = await prisma.userQualification.upsert({
    where: { userId_qualificationId: { userId, qualificationId: id } },
    create: {
      userId,
      qualificationId: id,
      expireAt,
      status: 'VALID',
      note: note || null,
    },
    update: {
      expireAt,
      status: 'VALID',
      note: note || null,
    },
    include: {
      qualification: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
    },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'GRANT',
    targetType: 'QUALIFICATION',
    targetId: id,
    targetName: qualification.name,
    afterData: { userId, userName: user.name, expireAt: expireAt.toISOString() },
    note: `授予${user.name}资质「${qualification.name}」，有效期至 ${expireAt.toLocaleDateString('zh-CN')}`,
  });

  return NextResponse.json({
    data: userQualification,
    message: `已授予${user.name}资质「${qualification.name}」`,
  });
});

/**
 * GET /api/qualifications/[id]/grant
 * 获取持有此资质的用户列表
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const qualification = await prisma.qualification.findFirst({
    where: { id, OR: [{ labId: authResult.labId }, { scope: 'PLATFORM' }] },
    select: { id: true },
  });
  if (!qualification) return NextResponse.json({ error: '资质模板不存在' }, { status: 404 });
  const userQualifications = await prisma.userQualification.findMany({
    where: {
      qualificationId: id,
      user: { labMemberships: { some: { labId: authResult.labId, status: 'ACTIVE' } } },
    },
    include: {
      user: { select: { id: true, name: true, role: true, email: true } },
    },
    orderBy: { grantedAt: 'desc' },
  });

  return NextResponse.json({ data: userQualifications });
});
