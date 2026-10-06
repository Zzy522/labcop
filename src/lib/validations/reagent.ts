import { z } from 'zod';
import { isValidCasNumber } from '@/lib/cas-number';

export const riskLevelSchema = z.enum(['LOW', 'HIGH']);
const casNumberSchema = z.string().trim().refine(
  (value) => !value || isValidCasNumber(value),
  'CAS 号格式或校验位不正确，请核对原始标签'
);

export const createReagentSchema = z.object({
  name: z.string({ error: '请填写试剂名称' }).trim().min(1, '请填写试剂名称').max(200, '试剂名称不能超过 200 个字符'),
  casNumber: casNumberSchema.optional().default(''),
  // 规格必填：用于后续单位换算（如 500mL/瓶、10mg/瓶）
  specification: z.string({ error: '请填写规格（如 500mL/瓶）' }).trim().min(1, '请填写规格（如 500mL、10mg、AR 500mL/瓶）'),
  brand: z.string().optional().default(''),
  dangerCategory: z.string().optional().default(''),
  riskLevel: riskLevelSchema.default('LOW'),
  isHazardous: z.boolean().default(false),
  isControlled: z.boolean().default(false),
  // 储存位置必填：入库时必须明确存放位置
  storageLocation: z.string({ error: '请填写存储位置（如 酸碱柜 A-1）' }).trim().min(1, '请填写存储位置（如 酸碱柜 A-1）'),
  stockQuantity: z.number({ error: '请填写库存数量（非负整数）' }).int('库存数量必须为整数').min(0, '库存不能为负数').default(0),
  minStock: z.number({ error: '最低库存请输入非负整数' }).int('最低库存必须为整数').min(0, '最低库存不能为负数').default(0),
  unit: z.string().optional().default(''),
  batchNumber: z.string().optional().default(''),
  expiryDate: z.string().optional().nullable(),
  labId: z.string().min(1, '实验室ID不能为空'),
  // SMILES 字段（可选）：PubChem 自动获取或人工绘制补全
  smiles: z.string().optional().default(''),
  molecularFormula: z.string().optional().default(''),
  molecularWeight: z.string().optional().default(''),
  iupacName: z.string().optional().default(''),
  structureImgUrl: z.string().optional().default(''),
});

// 更新 schema：独立定义，不继承 create schema 的 default()，避免 Zod v4 下 .partial() 仍应用默认值导致未传字段被覆盖
export const updateReagentSchema = z.object({
  name: z.string().min(1, '试剂名称不能为空').max(200).optional(),
  casNumber: casNumberSchema.optional(),
  specification: z.string().optional(),
  brand: z.string().optional(),
  dangerCategory: z.string().optional(),
  riskLevel: riskLevelSchema.optional(),
  isHazardous: z.boolean().optional(),
  isControlled: z.boolean().optional(),
  storageLocation: z.string().optional(),
  version: z.number().int().nonnegative(),
  minStock: z.number().int().min(0, '最低库存不能为负数').optional(),
  unit: z.string().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional().nullable(),
  smiles: z.string().optional(),
  molecularFormula: z.string().optional(),
  molecularWeight: z.string().optional(),
  iupacName: z.string().optional(),
  structureImgUrl: z.string().optional(),
}).strict();

export type CreateReagentInput = z.infer<typeof createReagentSchema>;
export type UpdateReagentInput = z.infer<typeof updateReagentSchema>;
