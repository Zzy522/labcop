import { logAudit } from './audit.service';
import { AppError, ErrorCategory } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/api-utils';
import { parseSpecification } from '@/lib/reagent-units';
import type { CreateReagentInput, UpdateReagentInput } from '@/lib/validations/reagent';

/**
 * 试剂服务层 — 试剂 CRUD + 台账记录
 */

/** 获取试剂列表（分页 + 筛选） */
export async function listReagents(params: {
  archived?: boolean;
  search?: string;
  riskLevel?: string;
  isHazardous?: boolean;
  isControlled?: boolean;
  storageLocation?: string;
  labId?: string;
  page: number;
  pageSize: number;
  // SMILES 子结构/精准查找
  smilesSearch?: string;
  smilesMode?: 'exact' | 'substructure';
}) {
  const { search, riskLevel, isHazardous, isControlled, storageLocation, labId, page, pageSize, smilesSearch } = params;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = { archivedAt: params.archived ? { not: null } : null };
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { casNumber: { contains: search } },
    ];
  }
  if (riskLevel) where.riskLevel = riskLevel;
  if (isHazardous !== undefined) where.isHazardous = isHazardous;
  if (isControlled !== undefined) where.isControlled = isControlled;
  if (storageLocation) where.storageLocation = { contains: storageLocation };
  if (labId) where.labId = labId;
  // SMILES 查询：精准和子结构均由前端 RDKit 过滤（化学语义匹配）
  // DB 层仅返回有 SMILES 字段的记录，避免字符串精确匹配漏掉同分异构写法
  if (smilesSearch && smilesSearch.trim()) {
    where.smiles = { not: null };
  }

  const [rawData, total] = await Promise.all([
    prisma.reagent.findMany({
      where,
      include: {
        lab: { select: { id: true, name: true, location: true } },
        stockInOperator: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.reagent.count({ where }),
  ]);

  // 内存补充容量信息（兼容历史数据，不回填 DB 避免 N+1 写入）
  // 真正的回填发生在 getReagent / createRequisition 路径
  const data = rawData.map((r) => {
    if ((!r.capacityPerUnit || !r.capacityUnit) && r.specification) {
      const parsed = parseSpecification(r.specification);
      if (parsed) {
        return { ...r, capacityPerUnit: parsed.capacityPerUnit, capacityUnit: parsed.capacityUnit };
      }
    }
    return r;
  });

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/** 获取试剂详情
 *
 * 含懒加载回填：若 capacityPerUnit/capacityUnit 为空但 specification 可解析，
 * 自动回填数据库并返回补全后的数据（兼容历史入库数据）。
 */
export async function getReagent(id: string) {
  const reagent = await prisma.reagent.findUnique({
    where: { id },
    include: {
      lab: true,
      stockInOperator: { select: { id: true, name: true } },
      reagentLogs: {
        include: { operator: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
      receiptDocumentLinks: {
        include: {
          document: {
            select: { id: true, fileName: true, mimeType: true, createdAt: true, uploadedById: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!reagent) throw new NotFoundError('试剂');

  // 懒加载回填容量信息
  if ((!reagent.capacityPerUnit || !reagent.capacityUnit) && reagent.specification) {
    const parsed = parseSpecification(reagent.specification);
    if (parsed) {
      try {
        await prisma.reagent.update({
          where: { id },
          data: { capacityPerUnit: parsed.capacityPerUnit, capacityUnit: parsed.capacityUnit },
        });
      } catch (e) {
        console.warn('[reagent] 回填 capacityPerUnit/capacityUnit 失败:', e);
      }
      return { ...reagent, capacityPerUnit: parsed.capacityPerUnit, capacityUnit: parsed.capacityUnit };
    }
  }
  return reagent;
}

/** 创建试剂 + 自动生成入库台账
 *
 * 规格自动解析：从 specification 字段（如 "500mL/瓶"、"10mg"、"AR 500mL"）
 * 自动提取容量信息填充 capacityPerUnit/capacityUnit，供后续领用单位换算使用。
 * 解析失败不阻断入库，capacityPerUnit/capacityUnit 留空，领用时提示用户补充。
 */
export async function createReagent(data: CreateReagentInput, operatorId: string) {
  // 验证实验室存在
  const lab = await prisma.lab.findUnique({ where: { id: data.labId } });
  if (!lab) throw new NotFoundError('实验室');

  // 自动解析规格 → capacityPerUnit/capacityUnit
  const parsed = parseSpecification(data.specification);

  return prisma.reagent.create({
    data: {
      name: data.name,
      casNumber: data.casNumber || null,
      specification: data.specification || null,
      brand: data.brand || null,
      dangerCategory: data.dangerCategory || null,
      riskLevel: data.riskLevel,
      isHazardous: data.isHazardous,
      isControlled: data.isControlled,
      storageLocation: data.storageLocation || null,
      stockQuantity: data.stockQuantity,
      // 累计入库瓶数：初始入库 = stockQuantity，后续追加入库时递增，领用不减
      totalStockedBottles: data.stockQuantity,
      minStock: data.minStock,
      unit: data.unit || null,
      // 容量信息：由 specification 自动解析（如 "500mL/瓶" → 500 mL）
      capacityPerUnit: parsed?.capacityPerUnit ?? null,
      capacityUnit: parsed?.capacityUnit ?? null,
      batchNumber: data.batchNumber || null,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      smiles: data.smiles || null,
      molecularFormula: data.molecularFormula || null,
      molecularWeight: data.molecularWeight || null,
      iupacName: data.iupacName || null,
      structureImgUrl: data.structureImgUrl || null,
      labId: data.labId,
      // 入库信息
      stockInDate: new Date(),
      stockInOperatorId: operatorId,
      reagentLogs: {
        create: {
          action: 'STOCK_IN',
          quantity: data.stockQuantity,
          operatorId,
          note: '试剂初始入库',
        },
      },
    },
    include: { lab: true, stockInOperator: { select: { id: true, name: true } } },
  });
}

/** 更新试剂
 *
 * 若 specification 变更，自动重新解析 capacityPerUnit/capacityUnit。
 */
export async function updateReagent(id: string, data: UpdateReagentInput, labId: string, operatorId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.reagent.findFirst({ where: { id, labId, archivedAt: null } });
    if (!before) throw new NotFoundError('试剂');
    if ((data.unit !== undefined && data.unit !== before.unit) || (data.specification !== undefined && data.specification !== before.specification)) {
      throw new ValidationError('已有库存的单位和规格不能直接修改，请新建正确批次并进行有记录的库存调整');
    }
    const { version, ...fields } = data;
    const changed = await tx.reagent.updateMany({
      where: { id, labId, version, archivedAt: null },
      data: { ...fields, expiryDate: fields.expiryDate === undefined ? undefined : fields.expiryDate ? new Date(fields.expiryDate) : null, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new AppError(ErrorCategory.BUSINESS_CONFLICT, '记录已被更新，请刷新后重试');
    const after = await tx.reagent.findUniqueOrThrow({ where: { id }, include: { lab: true } });
    await logAudit({ operatorId, labId, action: 'UPDATE', targetType: 'REAGENT', targetId: id, beforeData: before, afterData: after }, tx);
    return after;
  });
}

/** 归档与恢复均保留库存、台账和原始票据。 */
export async function archiveReagent(id: string, labId: string, operatorId: string, archived: boolean) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.reagent.findFirst({ where: { id, labId } });
    if (!before) throw new NotFoundError('试剂');
    const after = await tx.reagent.update({ where: { id, labId }, data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } } });
    await logAudit({ operatorId, labId, action: 'STATUS_CHANGE', targetType: 'REAGENT', targetId: id, beforeData: { archivedAt: before.archivedAt }, afterData: { archivedAt: after.archivedAt }, note: archived ? '归档，保留所有历史' : '恢复归档' }, tx);
    return after;
  });
}

/** 库存调整（增减库存 + 写台账）— 事务保护
 *
 * totalStockedBottles 仅在 delta > 0（追加入库）时递增，领用扣减时不改变，
 * 以保证"共 N 瓶"始终反映历史总入库量。
 */
export async function adjustStock(reagentId: string, delta: number, operatorId: string, note?: string) {
  return prisma.$transaction(async (tx) => {
    const reagent = await tx.reagent.findUnique({ where: { id: reagentId } });
    if (!reagent) throw new NotFoundError('试剂');
    const newQuantity = reagent.stockQuantity + delta;
    if (newQuantity < 0) throw new ValidationError('库存不足，无法扣减');

    const updateData: Record<string, unknown> = { stockQuantity: newQuantity };
    // 追加入库时累计总瓶数
    if (delta > 0) {
      updateData.totalStockedBottles = (reagent.totalStockedBottles ?? 0) + delta;
    }

    await tx.reagent.update({
      where: { id: reagentId },
      data: updateData,
    });
    await tx.reagentLog.create({
      data: {
        reagentId,
        action: delta > 0 ? 'STOCK_IN' : 'STOCK_OUT',
        quantity: Math.abs(delta),
        operatorId,
        note: note || (delta > 0 ? '库存增加' : '库存扣减'),
      },
    });
    return { ...reagent, stockQuantity: newQuantity, totalStockedBottles: updateData.totalStockedBottles as number ?? reagent.totalStockedBottles };
  });
}

/**
 * 查询同名/同CAS号的试剂 siblings（不同规格批次）
 *
 * 用途：
 * 1. 入库时查询上次储存位置（自动填入，用户确认）
 * 2. 显示同试剂的所有规格批次（多规格合并展示）
 * 3. 粗略估算总量（sum of stockQuantity × capacityPerUnit）
 *
 * 匹配规则：name 完全相同（同实验室），或 casNumber 相同且非空。
 * 按 stockInDate 降序，便于取"上次"入库记录。
 */
export async function findReagentSiblings(params: {
  name?: string;
  casNumber?: string;
  labId: string;
  excludeId?: string;
}) {
  const { name, casNumber, labId, excludeId } = params;
  if (!name && !casNumber) return [];

  const or: Record<string, unknown>[] = [];
  if (name && name.trim()) or.push({ name: name.trim() });
  if (casNumber && casNumber.trim()) or.push({ casNumber: casNumber.trim() });

  const where: Record<string, unknown> = {
    labId,
    OR: or,
  };
  if (excludeId) where.id = { not: excludeId };

  return prisma.reagent.findMany({
    where,
    select: {
      id: true,
      name: true,
      casNumber: true,
      specification: true,
      brand: true,
      stockQuantity: true,
      unit: true,
      capacityPerUnit: true,
      capacityUnit: true,
      storageLocation: true,
      stockInDate: true,
      expiryDate: true,
    },
    orderBy: { stockInDate: 'desc' },
    take: 20,
  });
}
