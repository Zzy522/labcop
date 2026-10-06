/**
 * 化合物知识库 Service
 *
 * 提供化合物主体、合成批次、生物活性测试、使用记录、文档的查询与写入逻辑。
 * 所有查询都强制按 labId 隔离，避免跨实验室数据泄露。
 */

import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/api-utils';
import { logAudit } from '@/lib/services/audit.service';
import type {
  CreateCompoundInput,
  ImportCompoundInput,
  UpdateCompoundInput,
  CreateSynthesisBatchInput,
  CreateBioAssayInput,
  CreateCompoundUsageLogInput,
  CreateCompoundDocumentInput,
} from '@/lib/validations/compound';

// ─── 化合物主体 ───

export interface ListCompoundsParams {
  labId: string;
  search?: string;
  status?: string;
  source?: string;
  casNumber?: string;
  page: number;
  pageSize: number;
}

export async function listCompounds(params: ListCompoundsParams) {
  const { labId, search, status, source, casNumber, page, pageSize } = params;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = { labId };
  if (status) where.status = status;
  if (source) where.source = source;
  if (casNumber) where.casNumber = casNumber;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { commonName: { contains: search } },
      { casNumber: { contains: search } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.compound.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        // 关联试剂：用于展示入库存量、存放位置、入库日、入库人
        reagent: {
          select: {
            id: true,
            name: true,
            casNumber: true,
            stockQuantity: true,
            totalStockedBottles: true,
            unit: true,
            storageLocation: true,
            stockInDate: true,
            capacityPerUnit: true,
            capacityUnit: true,
            purity: true,
            stockInOperator: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: {
            synthesisBatches: true,
            bioAssays: true,
            usageLogs: true,
            documents: true,
          },
        },
      },
    }),
    prisma.compound.count({ where }),
  ]);

  return { data, total, page, pageSize };
}

export async function getCompoundDetail(id: string, labId: string) {
  const compound = await prisma.compound.findFirst({
    where: { id, labId },
    include: {
      createdBy: { select: { id: true, name: true } },
      // 与 listCompounds 保持一致：完整试剂字段，供详情页展示库存/位置/入库人
      reagent: {
        select: {
          id: true,
          name: true,
          casNumber: true,
          stockQuantity: true,
          totalStockedBottles: true,
          unit: true,
          storageLocation: true,
          stockInDate: true,
          capacityPerUnit: true,
          capacityUnit: true,
          purity: true,
          stockInOperator: { select: { id: true, name: true } },
        },
      },
      synthesisBatches: {
        orderBy: { synthesizedAt: 'desc' },
        include: {
          operator: { select: { id: true, name: true } },
          _count: { select: { documents: true, bioAssays: true } },
        },
      },
      bioAssays: {
        orderBy: { testedAt: 'desc' },
        include: {
          testedBy: { select: { id: true, name: true } },
          batch: { select: { id: true, batchNumber: true } },
        },
      },
      usageLogs: {
        orderBy: { usedAt: 'desc' },
        take: 50,
        include: {
          usedBy: { select: { id: true, name: true } },
        },
      },
      documents: {
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: { select: { id: true, name: true } },
          batch: { select: { id: true, batchNumber: true } },
        },
      },
    },
  });
  if (!compound) throw new NotFoundError('化合物');
  return compound;
}

export async function createCompound(input: CreateCompoundInput | ImportCompoundInput, labId: string, userId: string) {
  // 若指定了 reagentId（关联已有试剂），需校验试剂属于同一实验室
  if (input.reagentId) {
    const reagent = await prisma.reagent.findFirst({
      where: { id: input.reagentId, labId },
      select: { id: true },
    });
    if (!reagent) {
      throw new ValidationError('关联试剂不存在或不属于当前实验室');
    }
  }

  if (input.projectId) {
    const project = await prisma.researchProject.findFirst({
      where: { id: input.projectId, labId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new ValidationError('关联课题不存在或不属于当前实验室');
    }
  }

  // 入库信息：新建化合物时同步创建关联试剂
  // - stockQuantity + stockUnit → Reagent.stockQuantity + unit
  // - purity → Reagent.purity
  // - storageLocation → Reagent.storageLocation
  // - 入库日 = 当前时间，入库人 = 当前用户（自动填充）
  // - specification 由 stockQuantity + stockUnit + purity 拼接（如 "10mg, 98%"）
  //
  // 注意：化合物以质量/体积为单位（如 mg），unit 字段本身就是质量/体积单位，
  // 不设置 capacityPerUnit/capacityUnit（那是"瓶↔mL/g"换算专用），
  // 这样 getStockDisplayText 会走 fallback 分支，直接显示 "剩余 10 mg"。
  let reagentId = input.reagentId;
  if (!reagentId) {
    const specification = `${input.stockQuantity}${input.stockUnit}${input.purity ? `, ${input.purity}` : ''}`;
    const reagent = await prisma.reagent.create({
      data: {
        name: input.name,
        casNumber: input.casNumber || null,
        specification,
        purity: input.purity || null,
        storageLocation: input.storageLocation,
        stockQuantity: input.stockQuantity,
        // 累计入库存量 = 初始入库量（不随领用递减）
        totalStockedBottles: input.stockQuantity,
        unit: input.stockUnit,
        // 化合物不设置 capacityPerUnit/capacityUnit：unit 本身就是质量/体积单位
        riskLevel: 'LOW',
        smiles: input.smiles,
        molecularFormula: input.molecularFormula || null,
        molecularWeight: input.molecularWeight ? String(input.molecularWeight) : null,
        labId,
        stockInDate: new Date(),
        stockInOperatorId: userId,
        reagentLogs: {
          create: {
            action: 'STOCK_IN',
            quantity: input.stockQuantity,
            operatorId: userId,
            note: '化合物入库',
          },
        },
      },
    });
    reagentId = reagent.id;
  }

  // 创建化合物主体，关联刚入库的试剂
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { stockQuantity, stockUnit, purity, storageLocation, projectId, ...compoundData } = input;
  return prisma.$transaction(async (tx) => {
    const compound = await tx.compound.create({
      data: {
        ...compoundData,
        reagentId,
        labId,
        createdById: userId,
        projectLinks: projectId ? {
          create: { projectId, addedById: userId },
        } : undefined,
      },
      include: {
        createdBy: { select: { id: true, name: true } },
        reagent: {
          select: {
            id: true,
            name: true,
            casNumber: true,
            stockQuantity: true,
            totalStockedBottles: true,
            unit: true,
            storageLocation: true,
            stockInDate: true,
            capacityPerUnit: true,
            capacityUnit: true,
            purity: true,
            stockInOperator: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (projectId) {
      await tx.projectChangeLog.create({
        data: {
          projectId,
          entityType: 'COMPOUND',
          entityId: compound.id,
          action: 'CREATE',
          afterData: JSON.stringify({ compoundId: compound.id, name: compound.name }),
          operatorId: userId,
        },
      });
    }

    return compound;
  });
}

export async function updateCompound(
  id: string,
  labId: string,
  input: UpdateCompoundInput,
  operatorId: string
) {
  const existing = await prisma.compound.findFirst({
    where: { id, labId },
    select: { id: true, name: true, commonName: true, casNumber: true, status: true, source: true, smiles: true, molecularFormula: true, molecularWeight: true, synthesisNote: true, reagentId: true },
  });
  if (!existing) throw new NotFoundError('化合物');

  // 若更改关联试剂，需校验
  if (input.reagentId) {
    const reagent = await prisma.reagent.findFirst({
      where: { id: input.reagentId, labId },
      select: { id: true },
    });
    if (!reagent) {
      throw new ValidationError('关联试剂不存在或不属于当前实验室');
    }
  }

  const updated = await prisma.compound.update({
    where: { id },
    data: input,
    include: {
      createdBy: { select: { id: true, name: true } },
    },
  });

  // 写审计日志（事务外，失败不影响主流程）
  await logAudit({
    operatorId,
    action: 'UPDATE',
    targetType: 'COMPOUND',
    targetId: id,
    targetName: existing.name,
    beforeData: existing,
    afterData: input,
    labId,
  });

  return updated;
}

export async function deleteCompound(id: string, labId: string, operatorId: string) {
  const existing = await prisma.compound.findFirst({
    where: { id, labId },
    select: { id: true, name: true, commonName: true, casNumber: true, status: true, source: true },
  });
  if (!existing) throw new NotFoundError('化合物');

  // 级联删除由 schema onDelete: Cascade 保证
  await prisma.compound.delete({ where: { id } });

  // 写审计日志
  await logAudit({
    operatorId,
    action: 'DELETE',
    targetType: 'COMPOUND',
    targetId: id,
    targetName: existing.name,
    beforeData: existing,
    note: `删除化合物：${existing.name}`,
    labId,
  });

  return { success: true };
}

// ─── 合成批次 ───

export async function createSynthesisBatch(
  input: CreateSynthesisBatchInput,
  labId: string,
  operatorId: string
) {
  // 校验化合物属于该实验室
  const compound = await prisma.compound.findFirst({
    where: { id: input.compoundId, labId },
    select: { id: true, name: true },
  });
  if (!compound) throw new NotFoundError('化合物');

  // 校验批次号唯一
  const dup = await prisma.synthesisBatch.findFirst({
    where: { compoundId: input.compoundId, batchNumber: input.batchNumber },
    select: { id: true },
  });
  if (dup) throw new ValidationError(`批次号 ${input.batchNumber} 已存在`);

  return prisma.synthesisBatch.create({
    data: {
      ...input,
      labId,
      operatorId,
      synthesizedAt: new Date(input.synthesizedAt),
    },
    include: {
      operator: { select: { id: true, name: true } },
    },
  });
}

// ─── 生物活性测试 ───

export async function createBioAssay(
  input: CreateBioAssayInput,
  labId: string,
  testedById: string
) {
  const compound = await prisma.compound.findFirst({
    where: { id: input.compoundId, labId },
    select: { id: true },
  });
  if (!compound) throw new NotFoundError('化合物');

  if (input.batchId) {
    const batch = await prisma.synthesisBatch.findFirst({
      where: { id: input.batchId, labId, compoundId: input.compoundId },
      select: { id: true },
    });
    if (!batch) throw new ValidationError('关联批次不存在');
  }

  return prisma.bioAssay.create({
    data: {
      ...input,
      labId,
      testedById,
      testedAt: new Date(input.testedAt),
    },
    include: {
      testedBy: { select: { id: true, name: true } },
      batch: { select: { id: true, batchNumber: true } },
    },
  });
}

// ─── 使用记录 ───

export async function createUsageLog(
  input: CreateCompoundUsageLogInput,
  labId: string,
  usedById: string
) {
  const compound = await prisma.compound.findFirst({
    where: { id: input.compoundId, labId },
    select: { id: true, name: true },
  });
  if (!compound) throw new NotFoundError('化合物');

  return prisma.compoundUsageLog.create({
    data: {
      ...input,
      labId,
      usedById,
      usedAt: new Date(input.usedAt),
    },
    include: {
      usedBy: { select: { id: true, name: true } },
    },
  });
}

// ─── 文档 ───

export async function createDocument(
  input: CreateCompoundDocumentInput,
  labId: string,
  uploadedById: string
) {
  const compound = await prisma.compound.findFirst({
    where: { id: input.compoundId, labId },
    select: { id: true },
  });
  if (!compound) throw new NotFoundError('化合物');

  if (input.batchId) {
    const batch = await prisma.synthesisBatch.findFirst({
      where: { id: input.batchId, labId, compoundId: input.compoundId },
      select: { id: true },
    });
    if (!batch) throw new ValidationError('关联批次不存在');
  }

  return prisma.compoundDocument.create({
    data: {
      ...input,
      labId,
      uploadedById,
    },
    include: {
      uploadedBy: { select: { id: true, name: true } },
    },
  });
}
