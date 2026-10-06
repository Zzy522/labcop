import { prisma } from '@/lib/prisma';

/**
 * 资质校验服务
 * 用于在设备预约/使用、试剂申请时校验用户是否持有所需资质
 */

export interface QualificationCheckResult {
  passed: boolean;
  missing: Array<{ id: string; name: string }>;
  expired: Array<{ id: string; name: string; expireAt: Date }>;
}

/**
 * 校验用户是否持有指定设备所需的资质
 * @param userId 用户ID
 * @param deviceId 设备ID
 * @returns 校验结果
 */
export async function checkDeviceQualifications(userId: string, deviceId: string): Promise<QualificationCheckResult> {
  // 获取设备要求的资质
  const requirements = await prisma.deviceQualification.findMany({
    where: { deviceId },
    include: { qualification: true },
  });

  if (requirements.length === 0) {
    return { passed: true, missing: [], expired: [] };
  }

  // 获取用户持有的有效资质
  const userQuals = await prisma.userQualification.findMany({
    where: {
      userId,
      qualificationId: { in: requirements.map((r) => r.qualificationId) },
      status: 'VALID',
    },
    include: { qualification: true },
  });

  const now = new Date();
  const missing: Array<{ id: string; name: string }> = [];
  const expired: Array<{ id: string; name: string; expireAt: Date }> = [];

  for (const req of requirements) {
    const userQual = userQuals.find((uq) => uq.qualificationId === req.qualificationId);
    if (!userQual) {
      missing.push({ id: req.qualification.id, name: req.qualification.name });
    } else if (userQual.expireAt < now) {
      expired.push({ id: req.qualification.id, name: req.qualification.name, expireAt: userQual.expireAt });
    }
  }

  return {
    passed: missing.length === 0 && expired.length === 0,
    missing,
    expired,
  };
}

/**
 * 校验用户是否持有指定试剂所需的资质
 * @param userId 用户ID
 * @param reagentId 试剂ID
 * @returns 校验结果
 */
export async function checkReagentQualifications(userId: string, reagentId: string): Promise<QualificationCheckResult> {
  const requirements = await prisma.reagentQualification.findMany({
    where: { reagentId },
    include: { qualification: true },
  });

  if (requirements.length === 0) {
    return { passed: true, missing: [], expired: [] };
  }

  const userQuals = await prisma.userQualification.findMany({
    where: {
      userId,
      qualificationId: { in: requirements.map((r) => r.qualificationId) },
      status: 'VALID',
    },
    include: { qualification: true },
  });

  const now = new Date();
  const missing: Array<{ id: string; name: string }> = [];
  const expired: Array<{ id: string; name: string; expireAt: Date }> = [];

  for (const req of requirements) {
    const userQual = userQuals.find((uq) => uq.qualificationId === req.qualificationId);
    if (!userQual) {
      missing.push({ id: req.qualification.id, name: req.qualification.name });
    } else if (userQual.expireAt < now) {
      expired.push({ id: req.qualification.id, name: req.qualification.name, expireAt: userQual.expireAt });
    }
  }

  return {
    passed: missing.length === 0 && expired.length === 0,
    missing,
    expired,
  };
}

/**
 * 格式化校验失败信息
 */
export function formatQualificationError(result: QualificationCheckResult): string {
  const parts: string[] = [];
  if (result.missing.length > 0) {
    parts.push(`缺少资质：${result.missing.map((q) => q.name).join('、')}`);
  }
  if (result.expired.length > 0) {
    parts.push(`资质已过期：${result.expired.map((q) => q.name).join('、')}`);
  }
  return parts.join('；');
}
