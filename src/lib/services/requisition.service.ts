import { idempotentTransaction, requestDigest } from '@/lib/idempotency';
import { prisma } from '@/lib/prisma';
import { NotFoundError, ValidationError } from '@/lib/api-utils';
import { checkPermission } from '@/lib/rules/permissionRules';
import { reviewRequisition } from '@/lib/rules/chemicalRules';
import { convertToStockUnit, formatAmount } from '@/lib/reagent-units';
import type { CreateRequisitionInput, ReviewRequisitionInput } from '@/lib/validations/requisition';

/**
 * 领用服务层 — 申请创建、规则审查、审核、库存扣减
 */

/** 获取领用申请列表 */
export async function listRequisitions(params: {
  status?: string;
  applicantId?: string;
  labId?: string;
  page: number;
  pageSize: number;
}) {
  const { status, applicantId, labId, page, pageSize } = params;
  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (applicantId) where.applicantId = applicantId;
  // 数据隔离：按 labId 过滤（兼容历史数据 labId=null，本实验室用户也能看到）
  if (labId) {
    where.labId = labId;
    where.reagent = { labId };
  }

  const [data, total] = await Promise.all([
    prisma.requisition.findMany({
      where,
      include: {
        reagent: { select: { id: true, name: true, casNumber: true, dangerCategory: true, riskLevel: true, isHazardous: true, stockQuantity: true } },
        applicant: { select: { id: true, name: true, role: true } },
        reviewer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.requisition.count({ where }),
  ]);

  return { data, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/** 创建领用申请 — 含规则审查和库存扣减
 * mode=CHECKOUT（领用）：低风险非管制品，仅用量必填，自动通过扣库存
 * mode=APPLY（申请）：高风险或管制品，需使用时间+用量+用途，待管理员审批
 *
 * 单位换算：用户输入 requestedQuantity + requestedUnit（如 50 mL），
 * 通过 convertToStockUnit 换算到 reagent.unit（如 0.1 瓶），
 * 用换算后的 quantity 扣减 stockQuantity。
 */
export async function createRequisition(input: CreateRequisitionInput & { labId: string; requestKey: string }) {
  return idempotentTransaction({ labId: input.labId, userId: input.applicantId, operation: 'REQUISITION', key: input.requestKey, digest: requestDigest(input) }, async (tx) => {
  const { reagentId, applicantId, purpose, labId, mode, usageTime, requestedQuantity, requestedUnit } = input;

  // 查询试剂
  const reagentRaw = await tx.reagent.findFirst({ where: { id: reagentId, labId, archivedAt: null } });
  if (!reagentRaw) throw new NotFoundError('试剂');
  // 懒加载回填容量信息（兼容历史数据）
  const reagent = reagentRaw;

  // 查询申请人
  const applicant = await tx.user.findUnique({ where: { id: applicantId } });
  if (!applicant) throw new NotFoundError('申请人');
  const membership = await tx.labMembership.findFirst({ where: { userId: applicantId, labId, status: 'ACTIVE', lab: { status: 'ACTIVE' } } });
  if (!membership) throw new NotFoundError('实验室成员');
  const applicantRole = membership.role === 'LAB_MEMBER' ? 'MEMBER' : 'ADMIN';

  // 校验：申请模式(APPLY)必须填写用途和使用时间
  if (mode === 'APPLY') {
    if (!purpose || purpose.trim().length === 0) {
      throw new ValidationError('申请模式下用途为必填项');
    }
    if (!usageTime) {
      throw new ValidationError('申请模式下使用时间为必填项');
    }
  }

  // 单位换算：把用户输入（如 50 mL）换算到库存单位（如 0.1 瓶）
  // 换算失败抛 ValidationError，前端展示给用户
  let convertedQuantity: number;
  let conversionNote: string;
  try {
    const result = convertToStockUnit(requestedQuantity, requestedUnit, reagent);
    convertedQuantity = result.stockDelta;
    conversionNote = result.note;
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : '单位换算失败');
  }

  // 库存不足校验
  if (convertedQuantity > reagent.stockQuantity) {
    throw new ValidationError(
      `库存不足：本次领用换算为 ${convertedQuantity.toFixed(4)} ${reagent.unit || '瓶'}，当前库存 ${reagent.stockQuantity} ${reagent.unit || '瓶'}`
    );
  }

  // 查询申请人当前活跃的危化品领用申请数
  const activeHazardousCount = await tx.requisition.count({
    where: {
      applicantId,
      status: { in: ['PENDING', 'NEEDS_CONFIRM', 'APPROVED'] },
      reagent: { isHazardous: true },
    },
  });

  // 1. 权限检查
  const permission = checkPermission({
    applicantRole,
    reagentRiskLevel: reagent.riskLevel,
    isHazardous: reagent.isHazardous,
    isControlled: reagent.isControlled,
  });

  let reviewResult;
  let status: string;

  if (!permission.allowed) {
    // 权限不足 → 阻断
    reviewResult = {
      result: 'BLOCKED',
      reasons: [permission.reason],
      suggestions: ['请联系管理员获取相应权限'],
    };
    status = 'BLOCKED';
  } else {
    // 2. 规则审查（用换算后的 quantity）
    reviewResult = reviewRequisition({
      reagentName: reagent.name,
      casNumber: reagent.casNumber || '',
      dangerCategory: reagent.dangerCategory || '',
      riskLevel: reagent.riskLevel,
      isHazardous: reagent.isHazardous,
      isControlled: reagent.isControlled,
      quantity: convertedQuantity,
      stockQuantity: reagent.stockQuantity,
      applicantRole,
      hasTraining: applicantRole !== 'MEMBER', // MVP: 非MEMBER视为已培训
      existingActiveRequisitions: activeHazardousCount,
      mode,
    });
    status = reviewResult.result;
  }

  // 根据 status 重新组合 conversionNote：APPROVED 显示剩余量，其他显示申请量
  // 避免「1 g ÷ 5 g/瓶 = 0.2000 瓶」这种换算公式暴露给用户
  const userReqStr = `${requestedQuantity} ${requestedUnit}`;
  if (status === 'APPROVED') {
    // 计算扣减后剩余量（优先用质量/体积总量，无容量信息时用瓶数）
    const remainingStock = reagent.stockQuantity - convertedQuantity;
    if (reagent.capacityPerUnit && reagent.capacityUnit) {
      const remainingAmount = remainingStock * reagent.capacityPerUnit;
      const remainingStr = formatAmount(remainingAmount, reagent.capacityUnit);
      conversionNote = `已领用 ${userReqStr}，剩余 ${remainingStr}`;
    } else {
      conversionNote = `已领用 ${userReqStr}，剩余 ${remainingStock} ${reagent.unit || '瓶'}`;
    }
  } else {
    // PENDING / NEEDS_CONFIRM / BLOCKED / REJECTED：未扣减库存，只显示申请量
    conversionNote = `申请领用 ${userReqStr}`;
  }

  // Claim and inventory movement are committed together.

    const scoped = await tx.reagent.findFirst({ where: { id: reagentId, labId, archivedAt: null } });
    if (!scoped) throw new NotFoundError('试剂');
    const requisition = await tx.requisition.create({
      data: {
        reagentId,
        applicantId,
        quantity: convertedQuantity,
        requestedQuantity,
        requestedUnit,
        conversionNote,
        purpose: purpose || null,
        status,
        reviewResult: JSON.parse(JSON.stringify(reviewResult)),
        labId: labId ?? reagent.labId, // 数据隔离：优先使用传入 labId，回退到 reagent.labId
        mode: mode || 'APPLY',
        usageTime: usageTime ? new Date(usageTime) : null,
      },
      include: {
        reagent: { select: { id: true, name: true, casNumber: true } },
        applicant: { select: { id: true, name: true, role: true } },
      },
    });

    // 4. 自动通过 → 立即扣减库存 + 写台账
    //    并发安全：用条件更新（stockQuantity >= qty）防 Lost Update / 超扣，
    //    并发领用时失败的请求会抛 ValidationError 而非把库存扣成负数
    if (status === 'APPROVED') {
      const decremented = await tx.reagent.updateMany({
        where: { id: reagentId, labId, archivedAt: null, stockQuantity: { gte: convertedQuantity } },
        data: { stockQuantity: { decrement: convertedQuantity }, version: { increment: 1 } },
      });
      if (decremented.count === 0) {
        throw new ValidationError(
          `库存不足或已被其他领用占用：本次需 ${convertedQuantity.toFixed(4)} ${reagent.unit || '瓶'}，请刷新后重试`
        );
      }
      await tx.reagentLog.create({
        data: {
          reagentId,
          action: 'STOCK_OUT',
          quantity: convertedQuantity,
          operatorId: applicantId,
          note: `${mode === 'CHECKOUT' ? '领用' : '申请'} ${requisition.id}（${conversionNote}，扣减 ${convertedQuantity.toFixed(4)} ${reagent.unit || '瓶'}）`,
        },
      });
    }

    // 5. NEEDS_CONFIRM 或 BLOCKED → 创建风险事件
    if (status === 'NEEDS_CONFIRM' || status === 'BLOCKED') {
      await tx.riskEvent.create({
        data: {
          type: 'UNAUTHORIZED',
          level: status === 'BLOCKED' ? 'CRITICAL' : 'WARNING',
          description: `领用申请 ${requisition.id}: ${reviewResult.reasons.join('; ')}`,
          reagentId,
          isResolved: status === 'BLOCKED',
          resolvedAt: status === 'BLOCKED' ? new Date() : null,
          labId: labId ?? reagent.labId, // 数据隔离
        },
      });
    }

    return { ...requisition, reviewResult };
  });
}

/** 审核领用申请 — 仅审核 NEEDS_CONFIRM/PENDING 状态 */
export async function reviewRequisitionAction(requisitionId: string, input: ReviewRequisitionInput, reviewerId: string, labId: string) {
  const { action, note } = input;

  const requisition = await prisma.requisition.findFirst({
    where: { id: requisitionId, labId, reagent: { labId } },
    include: { reagent: true },
  });
  if (!requisition) throw new NotFoundError('领用申请');

  if (!['NEEDS_CONFIRM', 'PENDING'].includes(requisition.status)) {
    throw new ValidationError(`当前状态为 ${requisition.status}，无法审核`);
  }

  return prisma.$transaction(async (tx) => {
    // 状态流转原子守卫：仅当当前状态仍为 NEEDS_CONFIRM/PENDING 时才更新，
    // 防并发重复审批（两个管理员同时点通过）。affectedRows=0 说明已被并发处理
    const statusGuard = await tx.requisition.updateMany({
      where: { id: requisitionId, labId, reagent: { labId }, status: { in: ['NEEDS_CONFIRM', 'PENDING'] } },
      data: {
        status: action,
        reviewedById: reviewerId,
        reviewedAt: new Date(),
      },
    });
    if (statusGuard.count === 0) {
      throw new ValidationError(`申请已被其他管理员处理或状态已变更，请刷新后重试`);
    }

    // 重新读取审核后的申请（含 reagent 用于库存扣减）
    const updated = await tx.requisition.findUnique({
      where: { id: requisitionId },
      include: {
        reagent: { select: { id: true, name: true, stockQuantity: true } },
        applicant: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
      },
    });
    if (!updated) throw new NotFoundError('领用申请');

    // 补充 reviewResult（保留旧结果 + 追加审核信息）
    await tx.requisition.update({
      where: { id: requisitionId },
      data: {
        reviewResult: JSON.parse(JSON.stringify({
          ...(typeof requisition.reviewResult === 'object' && requisition.reviewResult ? requisition.reviewResult : {}),
          reviewedBy: reviewerId,
          reviewedAt: new Date().toISOString(),
          reviewNote: note || null,
        })),
      },
    });

    // 审核通过 → 扣减库存（仅对未扣过库存的申请）
    // 并发安全：原子条件更新防超扣；状态守卫 updateMany 防重复审批扣减
    if (action === 'APPROVED' && requisition.status !== 'APPROVED') {
      const decremented = await tx.reagent.updateMany({
        where: { id: requisition.reagentId, labId, archivedAt: null, stockQuantity: { gte: requisition.quantity } },
        data: { stockQuantity: { decrement: requisition.quantity }, version: { increment: 1 } },
      });
      if (decremented.count === 0) {
        throw new ValidationError('库存不足或已被其他领用占用，无法通过审核');
      }
      await tx.reagentLog.create({
        data: {
          reagentId: requisition.reagentId,
          action: 'STOCK_OUT',
          quantity: requisition.quantity,
          operatorId: reviewerId,
          note: `领用申请 ${requisitionId} 审核通过`,
        },
      });
    }

    return updated;
  });
}
