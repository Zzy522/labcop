import { prisma } from '@/lib/prisma';

export const MAINTENANCE_ID = 'global';

export type MaintenanceSnapshot = {
  enabled: boolean;
  active: boolean;
  title: string;
  message: string;
  startsAt: string | null;
  estimatedEndAt: string | null;
  lastNotifiedAt: string | null;
  updatedAt: string | null;
};

const DEFAULT_MAINTENANCE: MaintenanceSnapshot = {
  enabled: false,
  active: false,
  title: 'Lab Copilot 升级中',
  message: '我们正在进行系统升级，请稍后再试。',
  startsAt: null,
  estimatedEndAt: null,
  lastNotifiedAt: null,
  updatedAt: null,
};

export async function getMaintenanceSnapshot(now = new Date()): Promise<MaintenanceSnapshot> {
  try {
    const config = await prisma.platformMaintenance.findUnique({ where: { id: MAINTENANCE_ID } });
    if (!config) return DEFAULT_MAINTENANCE;
    const active = config.enabled && (!config.startsAt || config.startsAt <= now);
    return {
      enabled: config.enabled,
      active,
      title: config.title,
      message: config.message,
      startsAt: config.startsAt?.toISOString() ?? null,
      estimatedEndAt: config.estimatedEndAt?.toISOString() ?? null,
      lastNotifiedAt: config.lastNotifiedAt?.toISOString() ?? null,
      updatedAt: config.updatedAt.toISOString(),
    };
  } catch (error) {
    // 数据库暂时不可用或部署尚未完成迁移时必须 fail-open，避免维护机制自身造成全站事故。
    console.error('[maintenance] failed to read configuration', error);
    return DEFAULT_MAINTENANCE;
  }
}
