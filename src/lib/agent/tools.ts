/**
 * Function Calling 工具定义 + 只读执行器
 *
 * 安全设计（只读约束）：
 * - 所有工具仅做 SELECT 查询（findMany/findFirst/count），绝不 create/update/delete
 * - 所有查询强制按 labId 隔离（数据边界）
 * - 工具白名单：LLM 只能调用此处注册的工具，无法触达写操作
 *
 * 工具覆盖：化合物/活性/靶点/合成路线/试剂（结构化查询，配合记忆系统的实体提取）
 */
import { prisma } from '@/lib/prisma';
import { isLikelySmilesQuery } from './intent';
import { matchEquivalentSmiles } from '@/lib/rdkit-server';

export interface ToolContext {
  labId: string;
  userId: string;
  isAdmin: boolean;
}

// ─── OpenAI tools schema ───
export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_compound',
      description: '查询化合物知识库及试剂库存。名称/编号/CAS 使用文本检索；SMILES 使用 RDKit 分子图规范化精确匹配，可识别同一化合物的不同等价 SMILES 写法。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '化合物名称、内部编号(如XY-001)、CAS号或SMILES' },
          queryType: {
            type: 'string',
            enum: ['AUTO', 'NAME', 'SMILES'],
            description: '查询类型。用户提供分子结构或 SMILES 时必须传 SMILES；名称/编号/CAS 传 NAME；不确定时传 AUTO。',
          },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_compound_bioassay',
      description: '查询某化合物的生物活性测试数据（IC50、MIC、抑菌率、细胞毒性等），可按测试类型过滤',
      parameters: {
        type: 'object',
        properties: {
          compoundKeyword: { type: 'string', description: '化合物名称或编号' },
          assayType: { type: 'string', description: '可选，测试类型：ANTIBACTERIAL/ANTITUMOR/ENZYME/CYTOTOXICITY/ANTIOXIDANT/OTHER' },
        },
        required: ['compoundKeyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_compounds_by_target',
      description: '查询作用于某个靶点/细胞系/菌株的化合物列表及其活性结果',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: '靶点/细胞系/菌株名称，如 A549、EGFR、大肠杆菌' },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_synthesis_route',
      description: '查询某化合物的合成路线/批次记录（反应条件、投料、收率、纯度、表征摘要）',
      parameters: {
        type: 'object',
        properties: {
          compoundKeyword: { type: 'string', description: '化合物名称或编号' },
        },
        required: ['compoundKeyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_reagent',
      description: '查询试剂库存信息（库存量、存储位置、危险等级、是否管制品、有效期、MSDS/SOP）',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '试剂名称或CAS号' },
        },
        required: ['keyword'],
      },
    },
  },
] as const;

const TOOL_NAME_SET = new Set(AGENT_TOOLS.map((t) => t.function.name));

/** 各工具依赖的 Prisma 模型（用于客户端未重新生成时的前置检查） */
const TOOL_REQUIRED_MODELS: Record<string, string[]> = {
  query_compound: ['compound', 'reagent'],
  query_compound_bioassay: ['compound', 'bioAssay'],
  query_compounds_by_target: ['bioAssay'],
  query_synthesis_route: ['compound', 'synthesisBatch'],
  query_reagent: ['reagent'],
};

/** 检查 Prisma Client 中模型是否可用（未执行 prisma generate 时模型为 undefined） */
function checkModelsAvailable(toolName: string): string | null {
  const required = TOOL_REQUIRED_MODELS[toolName] || [];
  const missing = required.filter(
    (m) => !(prisma as unknown as Record<string, unknown>)[m]
  );
  if (missing.length > 0) {
    return `数据库模型 [${missing.join(', ')}] 不可用：Prisma Client 未按最新 schema 生成，请管理员执行 npx prisma generate 并重启服务`;
  }
  return null;
}

/** 将原始错误转换为对用户/LLM 友好的描述，避免暴露 "Cannot read properties of undefined" 等内部细节 */
function toFriendlyError(error: unknown): string {
  if (error instanceof TypeError && /undefined|reading/i.test(error.message)) {
    return '数据库服务未就绪（Prisma Client 可能未重新生成），请管理员执行 npx prisma generate 并重启服务';
  }
  return error instanceof Error ? error.message : '未知错误';
}

/** 执行单个工具调用，返回 JSON 字符串结果（注入 tool 消息） */
export async function executeTool(name: string, argsJson: string, ctx: ToolContext): Promise<string> {
  // 白名单校验
  if (!TOOL_NAME_SET.has(name as (typeof AGENT_TOOLS)[number]['function']['name'])) {
    return JSON.stringify({ error: `未知工具：${name}` });
  }

  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}');
  } catch {
    return JSON.stringify({ error: '工具参数解析失败' });
  }

  // Prisma Client 模型可用性前置检查（防 generate 遗漏导致 TypeError 泄露给用户）
  const modelError = checkModelsAvailable(name);
  if (modelError) {
    return JSON.stringify({ error: modelError });
  }

  try {
    switch (name) {
      case 'query_compound':
        return await queryCompound(
          String(args.keyword || ''),
          String(args.queryType || 'AUTO'),
          ctx
        );
      case 'query_compound_bioassay':
        return await queryBioassay(String(args.compoundKeyword || ''), args.assayType ? String(args.assayType) : undefined, ctx);
      case 'query_compounds_by_target':
        return await queryByTarget(String(args.target || ''), ctx);
      case 'query_synthesis_route':
        return await querySynthesis(String(args.compoundKeyword || ''), ctx);
      case 'query_reagent':
        return await queryReagent(String(args.keyword || ''), ctx);
      default:
        return JSON.stringify({ error: `工具未实现：${name}` });
    }
  } catch (error) {
    return JSON.stringify({ error: `查询失败：${toFriendlyError(error)}` });
  }
}

// ─── 各工具的只读查询实现（强制 labId 隔离） ───

async function queryCompound(keyword: string, queryType: string, ctx: ToolContext): Promise<string> {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return JSON.stringify({ error: '缺少查询关键词' });

  const useStructureMatch = queryType === 'SMILES'
    || (queryType !== 'NAME' && isLikelySmilesQuery(normalizedKeyword));

  if (useStructureMatch) {
    const [compoundCandidates, reagentCandidates] = await Promise.all([
      prisma.compound.findMany({
        where: { labId: ctx.labId, smiles: { not: null } },
        select: {
          name: true, commonName: true, casNumber: true, smiles: true,
          molecularFormula: true, molecularWeight: true, source: true, status: true,
          physicochemical: true, safetyInfo: true, synthesisNote: true,
        },
      }),
      prisma.reagent.findMany({
        where: { labId: ctx.labId, smiles: { not: null } },
        select: {
          name: true, casNumber: true, smiles: true, molecularFormula: true,
          molecularWeight: true, specification: true, storageLocation: true,
          stockQuantity: true, unit: true, riskLevel: true,
          compounds: {
            select: { name: true, commonName: true, casNumber: true, status: true },
          },
        },
      }),
    ]);

    const [compoundResult, reagentResult] = await Promise.all([
      matchEquivalentSmiles(normalizedKeyword, compoundCandidates, (record) => record.smiles),
      matchEquivalentSmiles(normalizedKeyword, reagentCandidates, (record) => record.smiles),
    ]);

    if (!compoundResult.valid) {
      return JSON.stringify({
        error: '无法将输入解析为有效 SMILES',
        queryType: 'SMILES',
        query: normalizedKeyword,
      });
    }

    return JSON.stringify({
      queryType: 'SMILES',
      matchMethod: 'RDKit canonical molecular-graph exact match',
      query: normalizedKeyword,
      canonicalSmiles: compoundResult.canonicalSmiles,
      scanned: {
        compoundKnowledgeBaseWithSmiles: compoundCandidates.length,
        reagentInventoryWithSmiles: reagentCandidates.length,
      },
      count: compoundResult.matches.length + reagentResult.matches.length,
      compoundKnowledgeBase: {
        count: compoundResult.matches.length,
        records: compoundResult.matches,
      },
      reagentInventory: {
        count: reagentResult.matches.length,
        records: reagentResult.matches,
      },
    });
  }

  const [compounds, reagents] = await Promise.all([
    prisma.compound.findMany({
    where: {
      labId: ctx.labId,
      OR: [
        { name: { contains: normalizedKeyword } },
        { commonName: { contains: normalizedKeyword } },
        { casNumber: { contains: normalizedKeyword } },
      ],
    },
    take: 10,
    select: {
      name: true, commonName: true, casNumber: true, smiles: true,
      molecularFormula: true, molecularWeight: true, source: true, status: true,
      physicochemical: true, safetyInfo: true, synthesisNote: true,
    },
    }),
    prisma.reagent.findMany({
      where: {
        labId: ctx.labId,
        OR: [
          { name: { contains: normalizedKeyword } },
          { casNumber: { contains: normalizedKeyword } },
          { iupacName: { contains: normalizedKeyword } },
        ],
      },
      take: 10,
      select: {
        name: true, casNumber: true, iupacName: true, smiles: true,
        molecularFormula: true, molecularWeight: true, specification: true,
        storageLocation: true, stockQuantity: true, unit: true, riskLevel: true,
        compounds: {
          select: { name: true, commonName: true, casNumber: true, status: true },
        },
      },
    }),
  ]);

  return JSON.stringify({
    queryType: 'NAME_OR_IDENTIFIER',
    matchMethod: 'database text fields',
    query: normalizedKeyword,
    count: compounds.length + reagents.length,
    compoundKnowledgeBase: { count: compounds.length, records: compounds },
    reagentInventory: { count: reagents.length, records: reagents },
  });
}

async function queryBioassay(compoundKeyword: string, assayType: string | undefined, ctx: ToolContext): Promise<string> {
  if (!compoundKeyword.trim()) return JSON.stringify({ error: '缺少化合物关键词' });
  const compound = await prisma.compound.findFirst({
    where: {
      labId: ctx.labId,
      OR: [
        { name: { contains: compoundKeyword } },
        { commonName: { contains: compoundKeyword } },
        { casNumber: { contains: compoundKeyword } },
      ],
    },
    select: { id: true, name: true },
  });
  if (!compound) return JSON.stringify({ error: `未找到化合物「${compoundKeyword}」` });

  const assays = await prisma.bioAssay.findMany({
    where: {
      labId: ctx.labId,
      compoundId: compound.id,
      ...(assayType ? { assayType } : {}),
    },
    take: 20,
    orderBy: { testedAt: 'desc' },
    select: {
      assayType: true, target: true, result: true, resultSummary: true,
      conditions: true, conclusion: true, testedAt: true,
    },
  });
  return JSON.stringify({ compound: compound.name, count: assays.length, bioassays: assays });
}

async function queryByTarget(target: string, ctx: ToolContext): Promise<string> {
  if (!target.trim()) return JSON.stringify({ error: '缺少靶点关键词' });
  const assays = await prisma.bioAssay.findMany({
    where: {
      labId: ctx.labId,
      target: { contains: target },
    },
    take: 20,
    orderBy: { testedAt: 'desc' },
    select: {
      assayType: true, target: true, result: true, resultSummary: true, testedAt: true,
      compound: { select: { name: true, commonName: true, smiles: true } },
    },
  });
  return JSON.stringify({ target, count: assays.length, results: assays });
}

async function querySynthesis(compoundKeyword: string, ctx: ToolContext): Promise<string> {
  if (!compoundKeyword.trim()) return JSON.stringify({ error: '缺少化合物关键词' });
  const compound = await prisma.compound.findFirst({
    where: {
      labId: ctx.labId,
      OR: [
        { name: { contains: compoundKeyword } },
        { commonName: { contains: compoundKeyword } },
        { casNumber: { contains: compoundKeyword } },
      ],
    },
    select: { id: true, name: true },
  });
  if (!compound) return JSON.stringify({ error: `未找到化合物「${compoundKeyword}」` });

  const batches = await prisma.synthesisBatch.findMany({
    where: { labId: ctx.labId, compoundId: compound.id },
    take: 10,
    orderBy: { synthesizedAt: 'desc' },
    select: {
      batchNumber: true, synthesizedAt: true, procedure: true, reactionConditions: true,
      reactants: true, productMass: true, yieldPercent: true, purityPercent: true, characterizationNote: true,
    },
  });
  return JSON.stringify({ compound: compound.name, count: batches.length, batches });
}

async function queryReagent(keyword: string, ctx: ToolContext): Promise<string> {
  if (!keyword.trim()) return JSON.stringify({ error: '缺少查询关键词' });
  const reagents = await prisma.reagent.findMany({
    where: {
      labId: ctx.labId,
      OR: [{ name: { contains: keyword } }, { casNumber: { contains: keyword } }],
    },
    take: 10,
    select: {
      name: true, casNumber: true, specification: true, dangerCategory: true,
      riskLevel: true, isHazardous: true, isControlled: true, storageLocation: true,
      stockQuantity: true, unit: true, minStock: true, expiryDate: true,
      molecularFormula: true, smiles: true,
    },
  });
  return JSON.stringify({ count: reagents.length, reagents });
}
