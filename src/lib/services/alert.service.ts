import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/api-utils';

/**
 * 预警服务层 — 预警查询 + 风险事件管理
 */

export async function getAlertsData(labId: string) {
  const now = new Date();
  const thirtyDaysLater = new Date(now);
  thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

  // 试剂查询基础条件：按实验室隔离（强制）
  const reagentWhere: Record<string, unknown> = { labId };

  // 低库存：先取全部试剂，再用 JS 做字段间比较（避免 $queryRaw 与 libsql 适配器兼容性问题）
  const allReagents = await prisma.reagent.findMany({
    where: reagentWhere,
    select: {
      id: true,
      name: true,
      casNumber: true,
      stockQuantity: true,
      minStock: true,
      storageLocation: true,
      unit: true,
      brand: true,
    },
  });
  const lowStock = allReagents.filter((r) => r.stockQuantity <= r.minStock);

  // 临期试剂（30 天内过期）
  const expiring = await prisma.reagent.findMany({
    where: {
      ...reagentWhere,
      expiryDate: { gte: now, lte: thirtyDaysLater },
    },
    select: {
      id: true,
      name: true,
      casNumber: true,
      expiryDate: true,
      riskLevel: true,
      storageLocation: true,
    },
  });

  // 已过期试剂
  const expired = await prisma.reagent.findMany({
    where: {
      ...reagentWhere,
      expiryDate: { lt: now },
    },
    select: {
      id: true,
      name: true,
      casNumber: true,
      expiryDate: true,
      riskLevel: true,
      storageLocation: true,
    },
  });

  // 未解决风险事件：按 labId 字段直接过滤（兼容历史 labId=null 数据）
  const riskEvents = await prisma.riskEvent.findMany({
    where: {
      isResolved: false,
      labId,
    },
    include: {
      reagent: { select: { id: true, name: true } },
      device: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // 采购建议：基于低库存试剂计算补货量
  const purchaseSuggestions = lowStock.map((r) => ({
    id: r.id,
    name: r.name,
    brand: r.brand,
    stockQuantity: r.stockQuantity,
    minStock: r.minStock,
    suggestedQuantity: Math.max(r.minStock * 2 - r.stockQuantity, r.minStock),
    unit: r.unit,
  }));

  return { lowStock, expiring, expired, riskEvents, purchaseSuggestions };
}

/** 解决风险事件 */
export async function resolveRiskEvent(eventId: string, resolverId: string, labId: string) {
  const event = await prisma.riskEvent.findFirst({ where: { id: eventId, labId } });
  if (!event) throw new NotFoundError('风险事件');
  if (event.isResolved) throw new Error('该风险事件已解决');

  return prisma.riskEvent.update({
    where: { id: eventId, labId, isResolved: false },
    data: {
      isResolved: true,
      resolvedAt: new Date(),
      resolvedById: resolverId,
    },
  });
}
