import { z } from 'zod';

export const createRequisitionSchema = z.object({
  reagentId: z.string().min(1, '试剂ID不能为空'),
  applicantId: z.string().min(1, '申请人ID不能为空'),
  // quantity：换算到 reagent.unit 后的库存扣减量（如 0.1 瓶）
  // 由后端调用 convertToStockUnit 后填充；前端可传 0 占位
  // 改为 Float 支持小数（修复"领用 50 mL 扣 50 瓶"的 bug）
  quantity: z.number().positive('领用数量必须为正数'),
  // 用户原始输入（必填）
  requestedQuantity: z.number().positive('领用量必须为正数'),
  requestedUnit: z.string().min(1, '单位不能为空'),
  // purpose 改为可选：领用(CHECKOUT)不需要，申请(APPLY)在服务层强制必填
  purpose: z.string().max(500).optional(),
  // mode: CHECKOUT（领用，低风险直接扣库存）| APPLY（申请，需审批）
  mode: z.enum(['CHECKOUT', 'APPLY']).default('APPLY'),
  // usageTime: 仅 APPLY 模式必填，在服务层校验
  usageTime: z.string().optional(),
});

export const reviewRequisitionSchema = z.object({
  action: z.enum(['APPROVED', 'REJECTED'], { message: '审核动作必须是 APPROVED 或 REJECTED' }),
  note: z.string().max(500).optional(),
});

export type CreateRequisitionInput = z.infer<typeof createRequisitionSchema>;
export type ReviewRequisitionInput = z.infer<typeof reviewRequisitionSchema>;
