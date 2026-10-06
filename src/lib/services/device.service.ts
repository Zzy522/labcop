import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/api-utils';
import { logAudit } from '@/lib/services/audit.service';
import type { CreateDeviceInput, UpdateDeviceInput, CreateDeviceUsageInput } from '@/lib/validations/device';

/**
 * 设备服务层 — 设备 CRUD + 使用申请 + 状态变更审计 + 报废
 */

export async function listDevices(params: {
  search?: string;
  riskLevel?: string;
  status?: string;
  labId?: string;
  page: number;
  pageSize: number;
}) {
  const { search, riskLevel, status, labId, page, pageSize } = params;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (search) where.OR = [{ name: { contains: search } }, { model: { contains: search } }];
  if (riskLevel) where.riskLevel = riskLevel;
  if (status) {
    where.status = status;
  } else {
    // 默认隐藏已报废设备，需明确筛选才显示
    where.status = { not: 'SCRAPPED' };
  }
  if (labId) where.labId = labId;
  const now = new Date();

  const [data, total] = await Promise.all([
    prisma.device.findMany({
      where,
      include: {
        lab: { select: { id: true, name: true } },
        // 设备处于使用中时，用于在预约卡片中展示当前使用人。
        deviceUsages: {
          where: { status: 'NORMAL' },
          orderBy: { startTime: 'desc' },
          take: 1,
          select: {
            startTime: true,
            endTime: true,
            user: { select: { name: true } },
          },
        },
        // 下一条已确认预约用于展示“即将使用”，待审批预约不作为设备占用提示。
        reservations: {
          where: {
            status: 'APPROVED',
            startTime: { gt: now },
          },
          orderBy: { startTime: 'asc' },
          take: 1,
          select: {
            startTime: true,
            endTime: true,
            user: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.device.count({ where }),
  ]);

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

export async function getDevice(id: string) {
  const device = await prisma.device.findUnique({
    where: { id },
    include: {
      lab: true,
      deviceUsages: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!device) throw new NotFoundError('设备');
  return device;
}

export async function createDevice(data: CreateDeviceInput) {
  const lab = await prisma.lab.findUnique({ where: { id: data.labId } });
  if (!lab) throw new NotFoundError('实验室');
  return prisma.device.create({
    data: {
      name: data.name,
      model: data.model || null,
      serialNumber: data.serialNumber || null,
      location: data.location || null,
      riskLevel: data.riskLevel,
      status: data.status,
      labId: data.labId,
    },
    include: { lab: true },
  });
}

export async function updateDevice(id: string, data: UpdateDeviceInput, operatorId?: string) {
  return prisma.$transaction(async (tx) => {
  const before = await tx.device.findUniqueOrThrow({ where: { id } });

  // 已报废设备不可编辑
  if (before.status === 'SCRAPPED') {
    throw new ValidationError('已报废设备不可编辑');
  }

  const updated = await tx.device.update({
    where: { id },
    data,
    include: { lab: true },
  });

  // 写审计日志
  if (operatorId) {
    await logAudit({
      operatorId,
      action: 'UPDATE',
      targetType: 'DEVICE',
      targetId: id,
      targetName: before.name,
      beforeData: {
        name: before.name,
        model: before.model,
        serialNumber: before.serialNumber,
        location: before.location,
        riskLevel: before.riskLevel,
      },
      afterData: {
        name: updated.name,
        model: updated.model,
        serialNumber: updated.serialNumber,
        location: updated.location,
        riskLevel: updated.riskLevel,
      },
      note: '编辑设备信息', labId: before.labId,
    }, tx);
  }

  return updated;
  });
}

/**
 * 变更设备状态 — 带操作审计
 * - 从 IN_USE 变为其他状态：自动结束所有活跃使用记录，注明"管理员终止"
 * - 从其他状态变为 IN_USE：拒绝（需通过申请使用流程）
 */
export async function changeDeviceStatus(
  deviceId: string,
  newStatus: string,
  operatorId: string,
  reason?: string
) {
  const device = await getDevice(deviceId);
  const oldStatus = device.status;

  if (oldStatus === newStatus) {
    throw new ValidationError('设备状态未发生变化');
  }

  // 不允许直接通过状态修改将设备设为"使用中"（需走申请使用流程）
  if (newStatus === 'IN_USE') {
    throw new ValidationError('请通过"申请使用"流程使用设备，不可直接设置"使用中"');
  }

  return prisma.$transaction(async (tx) => {
    // 如果设备原先是"使用中"，结束所有活跃使用记录
    if (oldStatus === 'IN_USE') {
      const activeUsages = await tx.deviceUsage.findMany({
        where: { deviceId, status: 'NORMAL' },
      });

      if (activeUsages.length > 0) {
        const note = reason
          ? `管理员终止使用：${reason}`
          : '管理员终止使用';

        await Promise.all(
          activeUsages.map((usage) =>
            tx.deviceUsage.update({
              where: { id: usage.id },
              data: {
                status: 'COMPLETED',
                endTime: new Date(),
                note,
              },
            })
          )
        );
      }
    }

    // 更新设备状态
    const updated = await tx.device.update({
      where: { id: deviceId },
      data: { status: newStatus },
      include: { lab: true },
    });

    // 创建风险事件记录（状态变更审计）
    const statusLabels: Record<string, string> = {
      IDLE: '空闲',
      IN_USE: '使用中',
      MAINTENANCE: '维护中',
      DISABLED: '已停用',
    };

    // 如果是维护或停用，创建风险事件以便审计追踪
    if (newStatus === 'MAINTENANCE' || newStatus === 'DISABLED') {
      await tx.riskEvent.create({
        data: {
          type: 'DEVICE_ABNORMAL',
          level: newStatus === 'DISABLED' ? 'WARNING' : 'INFO',
          description: `设备「${device.name}」状态由管理员从「${statusLabels[oldStatus] ?? oldStatus}」变更为「${statusLabels[newStatus] ?? newStatus}」${reason ? `，原因：${reason}` : ''}`,
          deviceId,
          labId: device.labId,
          isResolved: newStatus !== 'MAINTENANCE', // 维护中未解决，停用视为已解决
          resolvedAt: newStatus !== 'MAINTENANCE' ? new Date() : null,
          resolvedById: newStatus !== 'MAINTENANCE' ? operatorId : null,
        },
      });
    }

    await logAudit({
      operatorId,
      labId: device.labId,
      action: 'STATUS_CHANGE',
      targetType: 'DEVICE',
      targetId: deviceId,
      targetName: device.name,
      beforeData: { status: oldStatus },
      afterData: { status: newStatus, reason: reason ?? null },
      note: `状态变更：${oldStatus} → ${newStatus}${reason ? `（${reason}）` : ''}`,
    }, tx);
    return {
      device: updated,
      audit: {
        oldStatus,
        newStatus,
        operatorId,
        reason: reason ?? null,
        terminatedUsages: oldStatus === 'IN_USE' ? true : false,
      },
    };
  });
}

export async function deleteDevice(id: string) {
  await getDevice(id);
  return prisma.device.delete({ where: { id } });
}

/**
 * 设备报废 — 软删除，设置 SCRAPPED 状态
 * - 取消所有未来预约（DeviceReservation PENDING/APPROVED）
 * - 结束活跃使用记录
 * - 写审计日志
 */
export async function scrapDevice(deviceId: string, operatorId: string, reason: string) {
  const device = await getDevice(deviceId);

  if (device.status === 'SCRAPPED') {
    throw new ValidationError('设备已报废，无需重复操作');
  }

  const oldStatus = device.status;

  return prisma.$transaction(async (tx) => {
    // 结束活跃使用记录
    if (oldStatus === 'IN_USE') {
      await tx.deviceUsage.updateMany({
        where: { deviceId, status: 'NORMAL' },
        data: { status: 'COMPLETED', endTime: new Date(), note: `设备报废，终止使用：${reason}` },
      });
    }

    // 取消未来预约（PENDING/APPROVED）
    await tx.deviceReservation.updateMany({
      where: {
        deviceId,
        status: { in: ['PENDING', 'APPROVED'] },
        startTime: { gte: new Date() },
      },
      data: { status: 'CANCELLED', note: `设备报废，自动取消预约：${reason}` },
    });

    // 更新设备状态
    const updated = await tx.device.update({
      where: { id: deviceId },
      data: {
        status: 'SCRAPPED',
        scrappedAt: new Date(),
        scrappedReason: reason,
      },
      include: { lab: true },
    });

    await logAudit({
      operatorId,
      labId: device.labId,
      action: 'SCRAP',
      targetType: 'DEVICE',
      targetId: deviceId,
      targetName: device.name,
      beforeData: { status: oldStatus },
      afterData: { status: 'SCRAPPED', scrappedAt: new Date().toISOString(), reason },
      note: `设备报废：${reason}`,
    }, tx);
    return { device: updated, oldStatus };
  });
}

/** 申请使用设备 — 事务保护 + 原子状态守卫（防并发重复占用同一设备） */
export async function applyDeviceUsage(deviceId: string, input: CreateDeviceUsageInput) {
  const device = await getDevice(deviceId);
  if (device.status !== 'IDLE') {
    throw new ValidationError('设备当前状态不可使用');
  }

  return prisma.$transaction(async (tx) => {
    // 原子状态守卫：仅当设备仍为 IDLE 时才置为 IN_USE，
    // 防并发下两个用户同时通过前置检查导致同一设备产生两条活跃使用记录
    const claimed = await tx.device.updateMany({
      where: { id: deviceId, status: 'IDLE' },
      data: { status: 'IN_USE' },
    });
    if (claimed.count === 0) {
      throw new ValidationError('设备刚被其他人占用或状态已变更，请刷新后重试');
    }

    // 创建使用记录
    const usage = await tx.deviceUsage.create({
      data: {
        deviceId,
        userId: input.userId,
        purpose: input.purpose,
        startTime: input.startTime ? new Date(input.startTime) : new Date(),
        endTime: input.endTime ? new Date(input.endTime) : null,
        status: 'NORMAL',
      },
      include: { user: { select: { id: true, name: true } } },
    });

    return usage;
  });
}

export async function listDeviceUsages(deviceId: string) {
  await getDevice(deviceId);
  return prisma.deviceUsage.findMany({
    where: { deviceId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

/** 释放设备（结束使用）— 事务保护
 *  - 普通用户：仅可结束自己的活跃使用记录
 *  - 管理员：可结束该设备上任意用户的活跃使用记录（管理员对所有设备拥有完全权限）
 */
export async function releaseDevice(
  deviceId: string,
  userId: string,
  options?: { isAdmin?: boolean }
) {
  const device = await getDevice(deviceId);
  if (device.status !== 'IN_USE') {
    throw new ValidationError('设备当前不在使用中，无需释放');
  }

  const isAdmin = !!options?.isAdmin;

  // 查找活跃使用记录：管理员不限使用人，普通用户仅限本人
  const activeUsage = await prisma.deviceUsage.findFirst({
    where: {
      deviceId,
      status: 'NORMAL',
      ...(isAdmin ? {} : { userId }),
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!activeUsage) {
    throw new ValidationError(
      isAdmin
        ? '该设备当前无活跃使用记录，无法释放'
        : '未找到您的使用记录，无法释放'
    );
  }

  return prisma.$transaction(async (tx) => {
    // 更新使用记录状态为已完成
    await tx.deviceUsage.update({
      where: { id: activeUsage.id },
      data: {
        status: 'COMPLETED',
        endTime: new Date(),
      },
    });

    // 检查是否还有其他活跃使用记录
    const otherActiveCount = await tx.deviceUsage.count({
      where: {
        deviceId,
        status: 'NORMAL',
      },
    });

    // 如果没有其他活跃使用，将设备状态改回空闲
    if (otherActiveCount === 0) {
      await tx.device.update({
        where: { id: deviceId },
        data: { status: 'IDLE' },
      });
    }

    return { success: true, message: '设备已释放' };
  });
}
