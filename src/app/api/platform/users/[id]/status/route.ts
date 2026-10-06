import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requirePlatformAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { platformAuditData } from '@/lib/platform-audit';
import { revokeAllUserSessions } from '@/lib/auth-session';
import { z } from 'zod';

const schema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']), reason: z.string().trim().min(1).max(500) });

export const PATCH = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requirePlatformAdmin(request);
  if (!isUserContext(auth)) return auth;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '状态或原因无效' }, { status: 400 });
  const { id } = await params;
  if (id === auth.userId && parsed.data.status !== 'ACTIVE') return NextResponse.json({ error: '不能停用当前登录的平台管理员' }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, status: true, platformRole: true } });
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  if (user.status === 'RETIRED') return NextResponse.json({ error: '已删除账号不能恢复登录，请使用原邮箱重新注册' }, { status: 409 });
  if (['PENDING_APPROVAL', 'REJECTED'].includes(user.status) && parsed.data.status === 'ACTIVE') {
    return NextResponse.json({ error: '待审批或已拒绝账号不能通过状态接口激活，必须完成对应审批流程' }, { status: 400 });
  }
  if (user.platformRole === 'PLATFORM_ADMIN' && parsed.data.status !== 'ACTIVE') {
    const activePlatformAdmins = await prisma.user.count({ where: { platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE' } });
    if (activePlatformAdmins <= 1) return NextResponse.json({ error: '不能停用唯一的有效平台管理员' }, { status: 400 });
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id, status: { not: 'RETIRED' } }, data: { status: parsed.data.status, statusReason: parsed.data.reason, statusChangedAt: new Date() } }),
    prisma.platformAuditLog.create({ data: platformAuditData({ operatorId: auth.userId, action: 'CHANGE_USER_STATUS', targetType: 'USER', targetId: id, before: { status: user.status }, after: { status: parsed.data.status }, note: parsed.data.reason }) }),
  ]);
  await revokeAllUserSessions(id);
  return NextResponse.json({ message: '用户状态已更新，现有会话已吊销' });
});
