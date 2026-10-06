import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/user-qualifications/[id]
 * 撤销用户资质（仅管理员）
 */
export const PATCH = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { action, note } = body as { action?: string; note?: string };

  if (action !== 'REVOKE') {
    return NextResponse.json({ error: '不支持的操作，仅支持 REVOKE' }, { status: 400 });
  }

  const userQual = await prisma.userQualification.findUnique({
    where: { id },
    include: {
      qualification: { select: { id: true, name: true, labId: true, scope: true } },
      user: { select: { id: true, name: true, labMemberships: { where: { labId: authResult.labId, status: 'ACTIVE' }, select: { id: true } } } },
    },
  });
  if (!userQual) {
    return NextResponse.json({ error: '用户资质记录不存在' }, { status: 404 });
  }
  if (userQual.user.labMemberships.length === 0 || (userQual.qualification.scope !== 'PLATFORM' && userQual.qualification.labId !== authResult.labId)) {
    return NextResponse.json({ error: '无权操作其他实验室的资质记录' }, { status: 403 });
  }

  if (userQual.status === 'REVOKED') {
    return NextResponse.json({ error: '该资质已被撤销' }, { status: 400 });
  }

  const updated = await prisma.userQualification.update({
    where: { id },
    data: {
      status: 'REVOKED',
      note: note || '管理员撤销',
    },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'REVOKE',
    targetType: 'QUALIFICATION',
    targetId: userQual.qualificationId,
    targetName: userQual.qualification.name,
    beforeData: { status: userQual.status },
    afterData: { status: 'REVOKED' },
    note: `撤销${userQual.user.name}的资质「${userQual.qualification.name}」${note ? `：${note}` : ''}`,
  });

  return NextResponse.json({ data: updated, message: '已撤销资质' });
});
