import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { z } from 'zod';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const updateQualificationSchema = z.object({
  name: z.string().min(1, '资质名称不能为空').max(100).optional(),
  description: z.string().max(500).optional(),
  validMonths: z.number().int().min(1).max(120).optional(),
});

/**
 * GET /api/qualifications/[id]
 * 获取资质模板详情（含已授权用户列表）
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const qualification = await prisma.qualification.findFirst({
    where: { id, OR: [{ labId: authResult.labId }, { scope: 'PLATFORM' }] },
    include: {
      userQualifications: {
        include: { user: { select: { id: true, name: true, role: true, email: true } } },
        orderBy: { grantedAt: 'desc' },
      },
      deviceRequirements: {
        include: { device: { select: { id: true, name: true } } },
      },
      reagentRequirements: {
        include: { reagent: { select: { id: true, name: true } } },
      },
    },
  });

  if (!qualification) {
    return NextResponse.json({ error: '资质模板不存在' }, { status: 404 });
  }

  return NextResponse.json({ data: qualification });
});

/**
 * PUT /api/qualifications/[id]
 * 更新资质模板（仅管理员）
 */
export const PUT = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const body = await request.json();
  const parsed = updateQualificationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  const before = await prisma.qualification.findFirst({ where: { id, labId: authResult.labId, scope: 'LAB' } });
  if (!before) {
    return NextResponse.json({ error: '资质模板不存在' }, { status: 404 });
  }

  // 名称唯一性检查
  if (parsed.data.name && parsed.data.name !== before.name) {
    const existing = await prisma.qualification.findFirst({ where: { name: parsed.data.name, labId: authResult.labId } });
    if (existing) {
      return NextResponse.json({ error: '资质名称已存在' }, { status: 400 });
    }
  }

  const updated = await prisma.qualification.update({
    where: { id },
    data: parsed.data,
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'UPDATE',
    targetType: 'QUALIFICATION',
    targetId: id,
    targetName: updated.name,
    beforeData: { name: before.name, description: before.description, validMonths: before.validMonths },
    afterData: parsed.data,
    note: `更新资质模板「${updated.name}」`,
  });

  return NextResponse.json({ data: updated, message: '资质模板已更新' });
});

/**
 * DELETE /api/qualifications/[id]
 * 删除资质模板（仅管理员，需无关联引用）
 */
export const DELETE = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const qualification = await prisma.qualification.findFirst({
    where: { id, labId: authResult.labId, scope: 'LAB' },
    include: {
      _count: {
        select: {
          userQualifications: true,
          deviceRequirements: true,
          reagentRequirements: true,
        },
      },
    },
  });

  if (!qualification) {
    return NextResponse.json({ error: '资质模板不存在' }, { status: 404 });
  }

  // 检查是否有关联引用
  const totalRefs = qualification._count.userQualifications + qualification._count.deviceRequirements + qualification._count.reagentRequirements;
  if (totalRefs > 0) {
    return NextResponse.json({
      error: `无法删除：该资质仍有 ${totalRefs} 个关联引用（用户授权/设备要求/试剂要求），请先解除关联`,
    }, { status: 400 });
  }

  await prisma.qualification.delete({ where: { id } });

  await logAudit({
    operatorId: authResult.userId,
    action: 'DELETE',
    targetType: 'QUALIFICATION',
    targetId: id,
    targetName: qualification.name,
    note: `删除资质模板「${qualification.name}」`,
  });

  return NextResponse.json({ message: '资质模板已删除' });
});
