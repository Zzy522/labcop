import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { z } from 'zod';

const createQualificationSchema = z.object({
  name: z.string().min(1, '资质名称不能为空').max(100),
  description: z.string().max(500).optional(),
  validMonths: z.number().int().min(1).max(120).default(36),
});

/**
 * GET /api/qualifications
 * 获取资质模板列表（所有登录用户可查看）
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const qualifications = await prisma.qualification.findMany({
    where: { OR: [{ labId: authResult.labId }, { scope: 'PLATFORM' }] },
    include: {
      _count: {
        select: {
          userQualifications: true,
          deviceRequirements: true,
          reagentRequirements: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ data: qualifications });
});

/**
 * POST /api/qualifications
 * 创建资质模板（仅管理员）
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const body = await request.json();
  const parsed = createQualificationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  // 检查名称唯一性
  const existing = await prisma.qualification.findFirst({
    where: { name: parsed.data.name, labId: authResult.labId },
  });
  if (existing) {
    return NextResponse.json({ error: '资质名称已存在' }, { status: 400 });
  }

  const qualification = await prisma.qualification.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description || null,
      validMonths: parsed.data.validMonths,
      labId: authResult.labId,
      scope: 'LAB',
    },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'CREATE',
    targetType: 'QUALIFICATION',
    targetId: qualification.id,
    targetName: qualification.name,
    afterData: { name: qualification.name, validMonths: qualification.validMonths },
    note: `创建资质模板「${qualification.name}」`,
  });

  return NextResponse.json({ data: qualification, message: '资质模板已创建' });
});
