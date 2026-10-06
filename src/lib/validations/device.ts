import { z } from 'zod';

export const deviceStatusSchema = z.enum(['IDLE', 'IN_USE', 'MAINTENANCE', 'DISABLED', 'SCRAPPED']);
export const deviceRiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const createDeviceSchema = z.object({
  name: z.string().min(1, '设备名称不能为空').max(200),
  model: z.string().optional().default(''),
  serialNumber: z.string().optional().default(''),
  location: z.string().optional().default(''),
  riskLevel: deviceRiskLevelSchema.default('LOW'),
  status: deviceStatusSchema.default('IDLE'),
  labId: z.string().min(1, '实验室ID不能为空'),
});

// 更新 schema：独立定义，不继承 create schema 的 default('')，避免未传字段被覆盖为空字符串
// 注意：SCRAPPED 状态只能通过报废接口设置，不能通过普通更新设置
export const updateDeviceSchema = z.object({
  name: z.string().min(1, '设备名称不能为空').max(200).optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  location: z.string().optional(),
  riskLevel: deviceRiskLevelSchema.optional(),
  // 状态变更走专用接口，普通更新不允许改状态
});

// 设备状态变更 schema：含操作人信息和原因（不含 SCRAPPED，报废走专用接口）
export const changeDeviceStatusSchema = z.object({
  status: z.enum(['IDLE', 'MAINTENANCE', 'DISABLED']),
  reason: z.string().max(500).optional(),
});

// 设备报废 schema
export const scrapDeviceSchema = z.object({
  reason: z.string().min(1, '报废原因不能为空').max(500),
});

export const createDeviceUsageSchema = z.object({
  userId: z.string().min(1, '使用人ID不能为空'),
  purpose: z.string().min(1, '用途不能为空').max(500),
  startTime: z.string().datetime({ message: '开始时间格式错误' }).optional(),
  endTime: z.string().datetime({ message: '结束时间格式错误' }).optional(),
});

export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
export type ChangeDeviceStatusInput = z.infer<typeof changeDeviceStatusSchema>;
export type ScrapDeviceInput = z.infer<typeof scrapDeviceSchema>;
export type CreateDeviceUsageInput = z.infer<typeof createDeviceUsageSchema>;
