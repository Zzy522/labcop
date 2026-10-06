import { z } from 'zod/v4';

const optionalDate = z.union([z.iso.datetime(), z.literal(''), z.null()]).optional();
export const TASK_TAGS = ['筹备', '进行', '等待', '完成'] as const;

export const projectCreateSchema = z.object({
  name: z.string().trim().min(2, '课题名称至少 2 个字符').max(120),
  description: z.string().trim().max(2000).optional(),
  objective: z.string().trim().max(4000).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED']).default('DRAFT'),
  startDate: optionalDate,
  endDate: optionalDate,
  managerIds: z.array(z.string()).min(1, '每个课题至少需要 1 名实验员课题管理员').max(3),
  memberIds: z.array(z.string()).max(100).default([]),
});

export const projectUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  objective: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  version: z.number().int().positive(),
});

export const projectMembersSchema = z.object({
  managerIds: z.array(z.string()).min(1, '每个课题至少需要 1 名实验员课题管理员').max(3),
  memberIds: z.array(z.string()).max(100).default([]),
}).refine((value) => new Set(value.managerIds).size === value.managerIds.length, {
  message: '课题管理员不能重复',
  path: ['managerIds'],
}).refine((value) => value.managerIds.every((id) => !value.memberIds.includes(id)), {
  message: '同一实验员不能同时是课题管理员和普通成员',
  path: ['memberIds'],
});

export const taskCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).optional(),
  parentId: z.string().nullable().optional(),
  startDate: optionalDate,
  estimatedWeeks: z.number().int().min(1, '预计时长至少 1 周').max(260, '预计时长不能超过 260 周').default(1),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']).default('PLANNED'),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  progress: z.number().int().min(0).max(100).refine((value) => value % 20 === 0, '完成度必须按 20% 档位设置').default(0),
  tags: z.array(z.enum(TASK_TAGS)).length(1, '请选择一个任务标签').default(['筹备']),
  stageNote: z.string().trim().max(2000).optional(),
  blockedReason: z.string().trim().max(1000).nullable().optional(),
  assigneeIds: z.array(z.string()).max(20).default([]),
  leadAssigneeId: z.string().nullable().optional(),
});

const taskPatchSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  parentId: z.string().nullable().optional(),
  startDate: optionalDate,
  estimatedWeeks: z.number().int().min(1, '预计时长至少 1 周').max(260, '预计时长不能超过 260 周').optional(),
  status: z.enum(['PLANNED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  progress: z.number().int().min(0).max(100).refine((value) => value % 20 === 0, '完成度必须按 20% 档位设置').optional(),
  tags: z.array(z.enum(TASK_TAGS)).length(1, '请选择一个任务标签').optional(),
  stageNote: z.string().trim().max(2000).optional(),
  blockedReason: z.string().trim().max(1000).nullable().optional(),
  assigneeIds: z.array(z.string()).max(20).optional(),
  leadAssigneeId: z.string().nullable().optional(),
});

export const taskUpdateSchema = taskPatchSchema.extend({
  version: z.number().int().positive(),
});

export const taskChangeRequestSchema = taskPatchSchema.extend({
  baseVersion: z.number().int().positive(),
  reason: z.string().trim().min(2, '请填写修改理由').max(1000),
});

export const reviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().trim().max(1000).optional(),
});

export const projectCompoundSchema = z.object({
  compoundId: z.string().min(1),
  role: z.enum(['LEAD', 'INTERMEDIATE', 'CONTROL', 'CANDIDATE', 'OTHER']).optional(),
});

export const weeklyReportSchema = z.object({
  weekStart: z.iso.datetime({ error: '请选择有效的周起始日期' }),
  title: z.string().trim().min(2, '周报标题至少 2 个字符').max(120, '周报标题不能超过 120 个字符'),
  content: z.string().trim().min(10, '本周进展至少 10 个字符（不含首尾空白），上传附件后仍需填写').max(12000, '本周进展不能超过 12000 个字符'),
  blockers: z.string().trim().max(4000, '阻塞事项不能超过 4000 个字符').optional(),
  nextPlan: z.string().trim().max(4000, '下周计划不能超过 4000 个字符').optional(),
});

/** Shared by the upload form and API; never silently discard selected files. */
export function validateWeeklyReportAttachments(files: Array<{ name: string; size: number }>): string | null {
  if (files.length > 8) return '周报附件最多 8 个，请减少附件后重试';
  const empty = files.find((file) => file.size === 0);
  if (empty) return `附件“${empty.name}”为空文件，请重新选择`;
  const oversized = files.find((file) => file.size > 15 * 1024 * 1024);
  if (oversized) return `附件“${oversized.name}”超过单个 15MB 限制`;
  if (files.reduce((sum, file) => sum + file.size, 0) > 50 * 1024 * 1024) return '周报附件总大小不能超过 50MB';
  if (files.some((file) => /\.(exe|msi|com|bat|cmd|ps1|sh|js|mjs|cjs|vbs|scr)$/i.test(file.name))) return '周报不允许上传可执行脚本或程序文件';
  return null;
}

export const projectSummarySchema = z.object({
  question: z.string().trim().max(2000).optional(),
  images: z.array(z.object({
    name: z.string().trim().min(1).max(240),
    dataUrl: z.string().startsWith('data:image/').max(7 * 1024 * 1024),
  })).max(5).default([]),
});

export function parseOptionalDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (!value) return null;
  return new Date(value);
}
