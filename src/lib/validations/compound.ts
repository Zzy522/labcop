import { z } from 'zod';

// ─── 化合物来源 ───
export const COMPOUND_SOURCES = ['SYNTHESIZED', 'PURCHASED', 'GIFT', 'OTHER'] as const;
// ─── 化合物状态 ───
export const COMPOUND_STATUSES = ['ACTIVE', 'ARCHIVED', 'DISPOSED'] as const;
// ─── 测试类型 ───
export const ASSAY_TYPES = [
  'ANTIBACTERIAL',
  'ANTITUMOR',
  'ENZYME',
  'CYTOTOXICITY',
  'ANTIOXIDANT',
  'OTHER',
] as const;
// ─── 使用类型 ───
export const COMPOUND_USAGE_TYPES = ['ASSAY', 'REQUISITION', 'TRANSFER', 'DISPOSAL', 'OTHER'] as const;
// ─── 文档类型 ───
export const COMPOUND_DOC_TYPES = [
  'NMR',
  'MS',
  'IR',
  'UV',
  'HPLC',
  'GC',
  'MSDS',
  'PURITY_REPORT',
  'OTHER',
] as const;

// ─── 化合物创建/更新 schema ───
// 新建化合物时同步入库：入库存量（数值+单位+纯度）+ 存放位置为必填，
// 入库日/入库人由后端自动填充（当前时间 + 当前登录用户）
const compoundCreateBaseSchema = z.object({
  name: z.string().min(1, '化合物名称不能为空').max(100),
  commonName: z.string().max(200).optional(),
  casNumber: z.string().max(50).optional(),
  // SMILES 必填：化合物必须有结构式（可由绘图器生成或直接输入）
  smiles: z.string().min(1, 'SMILES 不能为空').max(2000),
  molecularFormula: z.string().max(100).optional(),
  molecularWeight: z.number().positive().optional(),
  physicochemical: z.string().optional(), // JSON string
  safetyInfo: z.string().optional(), // JSON string
  synthesisNote: z.string().optional(),
  source: z.enum(COMPOUND_SOURCES).default('SYNTHESIZED'),
  status: z.enum(COMPOUND_STATUSES).default('ACTIVE'),
  reagentId: z.string().optional(),
  // ── 入库信息（新建化合物时同步创建关联试剂）──
  // 入库存量数值（如 10），必填
  stockQuantity: z.number().positive('入库存量必须为正数'),
  // 入库存量单位（如 mg、g、mL），必填
  stockUnit: z.string().min(1, '单位不能为空').max(20),
  // 纯度（如 "98%"、"AR 级"），可选
  purity: z.string().max(50).optional(),
  // 存放位置，必填
  storageLocation: z.string().min(1, '存放位置不能为空').max(200),
});

// 通过“新建化合物”创建时必须同步关联一个当前实验室课题。
export const createCompoundSchema = compoundCreateBaseSchema.extend({
  projectId: z.string().min(1, '请选择关联课题'),
});

// 保留批量导入的兼容性：历史 CSV 没有课题列，导入后仍可在课题知识库中补充关联。
export const importCompoundSchema = compoundCreateBaseSchema.extend({
  projectId: z.string().min(1).optional(),
});

// 更新 schema：独立定义，不包含入库字段（入库信息通过关联试剂管理，非 Compound 模型字段）
// 避免继承 createCompoundSchema.partial() 导致 stockQuantity/stockUnit/purity/storageLocation 误传
export const updateCompoundSchema = z.object({
  name: z.string().min(1, '化合物名称不能为空').max(100).optional(),
  commonName: z.string().max(200).optional(),
  casNumber: z.string().max(50).optional(),
  smiles: z.string().max(2000).optional(),
  molecularFormula: z.string().max(100).optional(),
  molecularWeight: z.number().positive().optional(),
  physicochemical: z.string().optional(),
  safetyInfo: z.string().optional(),
  synthesisNote: z.string().optional(),
  source: z.enum(COMPOUND_SOURCES).optional(),
  status: z.enum(COMPOUND_STATUSES).optional(),
  reagentId: z.string().optional(),
});

// ─── 合成批次 schema ───
export const createSynthesisBatchSchema = z.object({
  compoundId: z.string().min(1),
  batchNumber: z.string().min(1).max(50),
  synthesizedAt: z.string().or(z.date()),
  procedure: z.string().min(1, '合成步骤不能为空'),
  reactionConditions: z.string().optional(), // JSON
  reactants: z.string().optional(), // JSON
  productMass: z.number().positive().optional(),
  yieldPercent: z.number().min(0).max(100).optional(),
  purityPercent: z.number().min(0).max(100).optional(),
  characterizationNote: z.string().optional(),
  note: z.string().optional(),
});

export const updateSynthesisBatchSchema = createSynthesisBatchSchema.partial().omit({ compoundId: true });

// ─── 生物活性测试 schema ───
export const createBioAssaySchema = z.object({
  compoundId: z.string().min(1),
  batchId: z.string().optional(),
  assayType: z.enum(ASSAY_TYPES),
  target: z.string().max(200).optional(),
  result: z.string().min(1, '测试结果不能为空'), // JSON
  resultSummary: z.string().max(500).optional(),
  conditions: z.string().optional(), // JSON
  conclusion: z.string().optional(),
  note: z.string().optional(),
  testedAt: z.string().or(z.date()),
});

export const updateBioAssaySchema = createBioAssaySchema.partial().omit({ compoundId: true });

// ─── 化合物使用记录 schema ───
export const createCompoundUsageLogSchema = z.object({
  compoundId: z.string().min(1),
  usageType: z.enum(COMPOUND_USAGE_TYPES),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(20),
  purpose: z.string().max(500).optional(),
  relatedType: z.string().max(50).optional(),
  relatedId: z.string().optional(),
  usedAt: z.string().or(z.date()),
  note: z.string().optional(),
});

// ─── 化合物文档 schema ───
export const createCompoundDocumentSchema = z.object({
  compoundId: z.string().min(1),
  batchId: z.string().optional(),
  docType: z.enum(COMPOUND_DOC_TYPES),
  docSubtype: z.string().max(50).optional(),
  fileUrl: z.string().min(1),
  fileName: z.string().min(1).max(200),
  fileSize: z.number().int().positive().optional(),
  note: z.string().max(500).optional(),
});

// ─── 类型导出 ───
export type CreateCompoundInput = z.infer<typeof createCompoundSchema>;
export type ImportCompoundInput = z.infer<typeof importCompoundSchema>;
export type UpdateCompoundInput = z.infer<typeof updateCompoundSchema>;
export type CreateSynthesisBatchInput = z.infer<typeof createSynthesisBatchSchema>;
export type CreateBioAssayInput = z.infer<typeof createBioAssaySchema>;
export type CreateCompoundUsageLogInput = z.infer<typeof createCompoundUsageLogSchema>;
export type CreateCompoundDocumentInput = z.infer<typeof createCompoundDocumentSchema>;
