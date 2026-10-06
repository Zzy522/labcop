import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { AppError, ErrorCategory } from '@/lib/errors';
import { platformAuditData } from '@/lib/platform-audit';

/** Retire the login identity, never delete the historical User or its resources. */
export async function retireMember(operatorId: string, targetId: string, reason: string, labId?: string) {
  const deny = (message: string): never => { throw new AppError(ErrorCategory.BUSINESS_CONFLICT, message); };
  return prisma.$transaction(async tx => {
    const operator = await tx.user.findUnique({ where: { id: operatorId } });
    if (!operator || operator.status !== 'ACTIVE') deny('当前账号无操作权限');
    const actor = await tx.labMembership.findUnique({ where: { labId_userId: { labId: labId || '', userId: operatorId } } });
    if (labId ? !actor || actor.status !== 'ACTIVE' || !['LAB_ADMIN', 'LAB_OWNER'].includes(actor.role) : operator!.platformRole !== 'PLATFORM_ADMIN') deny('无删除成员权限');
    if (operatorId === targetId) deny('不能删除当前登录账号');
    const user = await tx.user.findUnique({ where: { id: targetId }, include: { labMemberships: true, collegeMemberships: true } });
    if (!user) deny('成员不存在');
    const target = user!;
    if (labId) {
      const membership = target.labMemberships.find(m => m.labId === labId && m.status === 'ACTIVE');
      if (!membership) deny('成员不属于当前实验室');
      if (actor!.role !== 'LAB_OWNER' && membership!.role !== 'LAB_MEMBER') deny('实验室管理员只能删除普通成员');
      if (target.labMemberships.some(m => m.labId !== labId) || target.collegeMemberships.length || (target.labId && target.labId !== labId)) deny('该账号关联其他组织，请由平台管理员处理');
      if (await tx.registrationApplication.count({ where: { userId: targetId, status: { in: ['PENDING', 'REVIEWING'] }, OR: [{ targetLabId: { not: labId } }, { targetLabId: null }] } })) deny('该账号有其他组织的申请，请由平台管理员处理');
    }
    if (target.platformRole === 'PLATFORM_ADMIN') deny('平台管理员账号不能在成员删除功能中注销');
    if (target.status === 'RETIRED') return { message: '账号已删除，业务资料仍保留' };
    if (target.labMemberships.some(m => m.role === 'LAB_OWNER') || await tx.lab.count({ where: { ownerId: targetId } })) deny('请先交接实验室负责人身份');
    const now = new Date();
    await tx.user.update({ where: { id: targetId }, data: {
      status: 'RETIRED', statusReason: reason, statusChangedAt: now,
      email: `retired-${targetId}@accounts.invalid`, password: `!retired-${randomBytes(32).toString('hex')}`,
      emailVerified: null, labId: null, role: 'MEMBER',
    } });
    await tx.labMembership.updateMany({ where: { userId: targetId }, data: { status: 'REMOVED', isPrimary: false } });
    await tx.collegeMembership.updateMany({ where: { userId: targetId }, data: { status: 'REMOVED' } });
    await tx.authSession.updateMany({ where: { userId: targetId, revokedAt: null }, data: { revokedAt: now } });
    await tx.passwordResetToken.deleteMany({ where: { userId: targetId } });
    await tx.emailVerificationToken.deleteMany({ where: { userId: targetId } });
    await tx.registrationApplication.updateMany({ where: { userId: targetId, status: 'PENDING' }, data: { status: 'REJECTED' } });
    await tx.joinRequest.updateMany({ where: { userId: targetId, status: 'PENDING' }, data: { status: 'REJECTED', rejectReason: '账号已注销', reviewedById: operatorId, reviewedAt: now } });
    await tx.platformAuditLog.create({ data: platformAuditData({ operatorId, action: 'RETIRE_MEMBER', targetType: 'USER', targetId, before: { status: target.status, email: target.email }, after: { status: 'RETIRED', labId: labId || null, resourcesPreserved: true }, note: reason }) });
    return { message: '账号已删除，登录已撤销，业务资料与历史作者保留；原邮箱可重新注册' };
  });
}
