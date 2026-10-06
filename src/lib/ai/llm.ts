import { getEffectiveLlmConfig } from '@/lib/api-config';
import { prisma } from '@/lib/prisma';
import { AppError, Errors, ErrorCategory } from '@/lib/errors';
import { withRetry, LLM_RETRY } from '@/lib/retry';
import { fetchUpstream } from '@/lib/upstream-fetch';

export interface StructuredResult {
  reagentName: string;
  casNumber: string;
  specification: string;
  remarks: string;
  brand: string;
  dangerCategory: string;
  riskLevel: string;
  isHazardous: boolean;
  isControlled: boolean;
  storageLocation: string;
  quantity: number;
  batchNumber: string;
  molecularFormula?: string;
  molecularWeight?: string;
  iupacName?: string;
  smiles?: string;
  structureImgUrl?: string;
  pubchemStatus?: 'ok' | 'not_found' | 'error' | 'skipped';
  pubchemError?: string;
  confidence: number;
  source: 'OCR' | 'VLM' | 'MANUAL';
  /** LLM 调用状态：用于前端诊断为何字段为空 */
  llmStatus?: 'ok' | 'no_config' | 'api_error' | 'parse_error' | 'fallback';
  /** LLM 调用失败时的错误信息（如 HTTP 401、额度不足等） */
  llmError?: string;
}

export interface StructureOptions {
  /** OCR/VLM 识别的原始文本，用于 LLM 提取 */
  ocrText?: string;
  labId?: string;
  userId: string;
}

export interface StructuredBatchResult {
  /** LLM 在输出中声明识别到的化合物数量。 */
  declaredCompoundCount: number;
  items: StructuredResult[];
}

const EXTRACTION_PROMPT = `你是实验室试剂信息提取助手。任务：从 OCR 识别文本中识别票据中的全部试剂/化合物，严格按 JSON 格式返回。

【输入】OCR 识别文本（可能包含表格、列表、自由文本，需语义理解）：
{ocrText}

【输出 Schema】必须返回符合以下结构的纯 JSON 对象；一张票据有几行化合物就返回几个 items，禁止只返回第一行：
{
  "compoundCount": "number，识别到的化合物/试剂总数，必须等于 items.length",
  "items": [{
    "reagentName":    "string，试剂/化合物名称（必填，无则空字符串）",
    "casNumber":      "string，CAS 号（格式如 7647-01-0，无则空字符串）",
    "specification":  "string，每瓶/每件的质量或容量规格，只保留用于库存换算的包装量，如 10mg、100g、500mL，不得混入浓度/纯度",
    "remarks":        "string，备注；把浓度、纯度、等级放在这里，如 10mg/mL、98.75%、AR；无则空字符串",
    "brand":          "string，品牌/厂家/生产商",
    "dangerCategory": "string，危险类别（如易燃、腐蚀、氧化性、剧毒）",
    "riskLevel":      "enum，LOW | HIGH；这是基于票据文字的初步建议",
    "isHazardous":    "boolean，是否危化品的初步建议",
    "isControlled":   "boolean，是否管制品的初步建议",
    "storageLocation":"string，票据未提及则为空，由用户补充",
    "quantity":       "number，瓶/支/包/盒等容器数量，正整数，默认 1，禁止填质量或体积数值",
    "batchNumber":    "string，批号/批次号"
  }]
}

【specification 提取规则】（重要）
- specification 表示“每瓶/每件的包装规格”，必须包含可计算的数字和单位，例如 500mL/瓶、100g/瓶、10mg/支，有时候可能与编号连在一起，例如“1069852-1g”则提取1g
- 必须从 OCR 中识别 g、kg、mg、mL、L 等包装质量/容量单位；浓度、纯度和等级必须放入 remarks，不得写入 specification
- 示例："98.75% 10mg" → specification="10mg"，remarks="98.75%"
- 示例："AR 500mL" → specification="500mL"，remarks="AR"
- 示例："10mg, 98.75%" → specification="10mg"，remarks="98.75%"
- 示例："10mg/mL, 5mL" → specification="5mL"，remarks="10mg/mL"
- 示例："500mL/瓶" → "500mL/瓶"
- 示例："2 × 500mL" → specification="500mL/瓶"，quantity=2
- 示例："5瓶 100g/瓶" → specification="100g/瓶"，quantity=5
- 若 OCR 文本中有规格信息，必须提取，不可返回空字符串

【quantity 提取规则】（重要）
- quantity 表示购买/入库的瓶、支、包、盒等容器数量，不是 g、mg、mL 数值
- OCR 只有“500mL”而没有数量列时，quantity=1，绝不能把 quantity 写成 500
- OCR 有“数量 3”“3瓶”“2×500mL”时，quantity 分别为 3、3、2
- 系统会使用 quantity × specification 中解析出的每容器容量计算总库存量，LLM 不要自行把总容量写入 quantity

【riskLevel 判定规则】（仅两级）
- LOW：常规低风险化学品（普通盐、糖类、一般无机盐、缓冲液等）
- HIGH：高风险化学品（易燃/腐蚀/氧化性/有毒/爆炸/强放射性，如盐酸、乙醇、氰化物、TNT）

【isControlled 判定规则】
- true：管制品（剧毒化学品、易制毒化学品、易制爆化学品、放射性物质、受公安或海关管制的化学品）
- false：常规化学品

【严格约束】
1. 先判断票据中共有多少个化合物并写入 compoundCount，再逐行识别全部化合物；compoundCount 必须等于 items.length
2. 同一票据出现多个 CAS 号时至少返回相同数量的 items，不能合并成一条
3. 每个 item 必须返回所有 12 个字段；缺失信息按字段类型返回 ""、1 或 false
4. riskLevel 必须是 LOW 或 HIGH；isHazardous、isControlled 必须是 boolean
5. quantity 必须是正整数，不可为字符串
6. specification 只能保存包装质量/容量；浓度、纯度、试剂等级统一写入 remarks
7. 不要臆造 CAS、危险属性或管制属性；无法判断时给出保守默认值，交由用户核对
8. 严禁返回 markdown 代码块、注释、解释文字、前后缀
9. 仅返回以 { 开头、} 结尾的纯 JSON 字符串

【输出示例】
{"compoundCount":1,"items":[{"reagentName":"盐酸","casNumber":"7647-01-0","specification":"500mL","remarks":"37%","brand":"国药集团","dangerCategory":"腐蚀性","riskLevel":"HIGH","isHazardous":true,"isControlled":false,"storageLocation":"","quantity":1,"batchNumber":"20240101"}]}`;

/** system 提示词：明确模型角色与输出契约 */
const SYSTEM_PROMPT = '你是实验室试剂信息提取助手。必须先计算化合物总数，再提取票据全部行并返回 {"compoundCount": number, "items": [...]} 纯 JSON 对象；compoundCount 必须等于 items.length，禁止遗漏后续 CAS 号，禁止输出 markdown、注释或解释。';

/**
 * 从 LLM 返回中提取 JSON
 * 处理：直接解析 / markdown 代码块 / 前后缀文字 / max_tokens 截断
 */
function extractJsonFromLLMResponse(text: string): Record<string, unknown> | null {
  // 1. 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {
    // 继续尝试其他方法
  }

  // 2. 尝试从 markdown 代码块中提取
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) {
    try {
      return JSON.parse(match[1].trim());
    } catch {
      // 继续尝试
    }
  }

  // 3. 尝试找到第一个 { 和最后一个 }
  const start = text.indexOf('{');
  if (start === -1) return null;

  const end = text.lastIndexOf('}');
  if (end !== -1 && end > start) {
    try {
      return JSON.parse(text.substring(start, end + 1));
    } catch {
      // 继续尝试截断修复
    }
  }

  // 4. JSON 可能被 max_tokens 截断（没有最后的 }）
  // 找最后一个完整的键值对分隔符（逗号），截断到那里，补全闭合 }
  const truncated = text.substring(start);
  const lastComma = truncated.lastIndexOf(',');
  if (lastComma !== -1) {
    // 截断到最后一个逗号之前（去除不完整的键值对），添加闭合 }
    const repaired = truncated.substring(0, lastComma) + '\n}';
    try {
      return JSON.parse(repaired);
    } catch {
      // 修复失败
    }
  }

  // 5. 最后尝试：直接添加闭合 }
  try {
    return JSON.parse(truncated + '}');
  } catch {
    return null;
  }
}

/**
 * LLM 结构化接口
 * 流程：
 * 1. 校验必须有 ocrText + userId + LLM 配置（未配置直接抛错，不再降级）
 * 2. 调用 LLM 提取关键内容，返回符合 StructuredResult 的对象
 * 3. 调用/解析失败时返回空结果（仅含 llmStatus + llmError 供前端诊断）
 */
export async function structureBatchWithLLM(
  _rawData: Record<string, string>,
  source: 'OCR' | 'VLM',
  options?: StructureOptions
): Promise<StructuredBatchResult> {
  // 前置检查：必须有 ocrText 和 userId
  if (!options?.ocrText || !options?.userId) {
    throw Errors.validationError('LLM 未接入：缺少 ocrText 或 userId，请接入 LLM 后再试');
  }

  // 获取 LLM 配置
  const llmConfig = await getEffectiveLlmConfig(options.labId, options.userId, prisma);
  if (!llmConfig) {
    // LLM 未配置：直接报错，不再降级到正则
    throw Errors.configMissing(
      'LLM 未接入：未配置 LLM API 凭证。请前往「API 配置」页面配置 LLM（个人或实验室级），接入后再试。',
      '/user/api-config',
      '前往配置 LLM'
    );
  }

  const prompt = EXTRACTION_PROMPT.replace('{ocrText}', options.ocrText);

  // LLM 调用：用 withRetry 包装 fetch，仅对可重试错误（网络/5xx/429）自动重试
  let response: Response;
  try {
    response = await withRetry(
      async () => {
        let res: Response;
        try {
          res = await fetchUpstream(`${llmConfig.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${llmConfig.apiKey}`,
            },
            body: JSON.stringify({
              model: llmConfig.model,
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt },
              ],
              temperature: 0,
              // 多行票据需要容纳全部 items，避免 2k token 截断后只保留前几行。
              max_tokens: 4000,
              response_format: { type: 'json_object' },
            }),
            cache: 'no-store',
            // 超时保护：避免 LLM 接口挂起导致请求长时间无响应
            signal: AbortSignal.timeout(60_000),
          });
        } catch (err) {
          // 网络层失败：抛可重试 AppError
          const reason = err instanceof Error ? err.message : String(err);
          throw Errors.networkError(reason, 'LLM');
        }

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          // 按状态码分类：401 → AUTH_INVALID（不重试）；429 → QUOTA_EXCEEDED（重试）；5xx → UPSTREAM_ERROR（重试）
          let category: ErrorCategory;
          let errorMsg: string;
          if (res.status === 401) {
            category = ErrorCategory.AUTH_INVALID;
            errorMsg = 'LLM API Key 无效（HTTP 401），请检查 API Key 配置';
          } else if (res.status === 402 || res.status === 429) {
            category = ErrorCategory.QUOTA_EXCEEDED;
            errorMsg = `LLM API 额度不足或限流（HTTP ${res.status}），请稍后重试或更换 Key`;
          } else if (res.status >= 500) {
            category = ErrorCategory.UPSTREAM_ERROR;
            errorMsg = `LLM API 调用失败：HTTP ${res.status} - ${errBody.slice(0, 200) || res.statusText}`;
          } else {
            category = ErrorCategory.UPSTREAM_ERROR;
            errorMsg = `LLM API 调用失败：HTTP ${res.status} - ${errBody.slice(0, 200) || res.statusText}`;
          }
          throw new AppError(category, errorMsg, {
            httpStatus: res.status,
            retryable: category === ErrorCategory.UPSTREAM_ERROR || category === ErrorCategory.QUOTA_EXCEEDED,
            actionUrl:
              category === ErrorCategory.AUTH_INVALID
                ? '/user/api-config'
                : undefined,
            actionText: category === ErrorCategory.AUTH_INVALID ? '前往配置 LLM' : undefined,
            context: { service: 'LLM', status: res.status, bodyPreview: errBody.slice(0, 500) },
          });
        }

        return res;
      },
      {
        ...LLM_RETRY,
        onRetry: (info) => {
          console.warn(
            `[LLM] 第 ${info.attempt} 次失败，${info.willRetry ? `将在 ${info.nextDelayMs}ms 后重试` : '不再重试'}`,
            info.error instanceof AppError ? info.error.message : info.error
          );
        },
      }
    );
  } catch (error) {
    // 重试耗尽或不可重试错误：返回带 llmStatus 的空结果（保持与旧 API 兼容）
    const appError = error instanceof AppError ? error : Errors.networkError(String(error), 'LLM');
    console.error(`[LLM] ${appError.message}`);
    const llmStatus: 'api_error' =
      appError.category === ErrorCategory.AUTH_INVALID ? 'api_error' : 'api_error';
    return { declaredCompoundCount: 0, items: [makeEmptyResult(source, llmStatus, appError.message)] };
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const finishReason = data?.choices?.[0]?.finish_reason;
  if (!content) {
    console.error('[LLM] 返回 content 为空，完整响应：', JSON.stringify(data).slice(0, 500));
    return { declaredCompoundCount: 0, items: [makeEmptyResult(source, 'parse_error', 'LLM 返回为空（content 为空）')] };
  }

  // 检查是否被 max_tokens 截断
  if (finishReason === 'length') {
    console.error(
      `[LLM] 返回被 max_tokens 截断（finish_reason=length），content 长度=${content.length}，完整内容：`,
      content
    );
  }

  const extracted = extractJsonFromLLMResponse(content);
  if (!extracted) {
    console.error(
      `[LLM] JSON 解析失败，finish_reason=${finishReason}，content 长度=${content.length}，完整内容：`,
      content
    );
    // 解析失败：抛 AppError（PARSE_ERROR 不重试，因为相同输入重试也会失败）
    const parseErr = Errors.parseError(
      `LLM 返回内容无法解析为 JSON${finishReason === 'length' ? '（被 max_tokens 截断）' : ''}，前 300 字符：${content.slice(0, 300)}`,
      content
    );
    console.error(`[LLM] ${parseErr.message}`);
    return { declaredCompoundCount: 0, items: [makeEmptyResult(source, 'parse_error', parseErr.message)] };
  }

  const batch = normalizeStructuredBatchExtraction(extracted, source);
  if (batch.items.length === 0) {
    return { declaredCompoundCount: 0, items: [makeEmptyResult(source, 'parse_error', 'LLM 没有返回任何试剂条目')] };
  }
  return batch;
}

/** 兼容只需要结构化数组的既有调用方。 */
export async function structureManyWithLLM(
  rawData: Record<string, string>,
  source: 'OCR' | 'VLM',
  options?: StructureOptions
): Promise<StructuredResult[]> {
  return (await structureBatchWithLLM(rawData, source, options)).items;
}

/** 将 LLM 的批量 JSON 转成可持久化结果；兼容旧模型返回单对象。 */
export function normalizeStructuredBatchExtraction(
  extracted: Record<string, unknown>,
  source: 'OCR' | 'VLM'
): StructuredBatchResult {
  const extractedItems = Array.isArray(extracted.items)
    ? extracted.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : extracted.reagentName || extracted.casNumber
      ? [extracted]
      : [];
  const declaredCompoundCount = Number(extracted.compoundCount);
  return {
    declaredCompoundCount: Number.isInteger(declaredCompoundCount) && declaredCompoundCount >= 0
      ? declaredCompoundCount
      : extractedItems.length,
    items: extractedItems.map((item) => normalizeExtractedItem(item, source)),
  };
}

/**
 * 将旧提示词或模型误放在 specification 中的浓度/纯度拆到备注。
 * specification 只留下可用于库存换算的每容器质量或容量。
 */
export function separateSpecificationRemarks(
  rawSpecification: unknown,
  rawRemarks: unknown
): { specification: string; remarks: string } {
  let specification = typeof rawSpecification === 'string' ? rawSpecification.trim() : '';
  const remarks = typeof rawRemarks === 'string' && rawRemarks.trim() ? [rawRemarks.trim()] : [];
  const concentrationPatterns = [
    /\b\d+(?:\.\d+)?\s*(?:kg|mg|ug|μg|µg|g)\s*\/\s*(?:mL|L|uL|μL|µL)\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:mmol\s*\/\s*L|mol\s*\/\s*L|mM|μM|uM|µM|M)\b/g,
    /\b\d+(?:\.\d+)?\s*%/g,
    /\b(?:AR|GR|CP|ACS|HPLC)\b(?:\s*级)?/gi,
  ];

  for (const pattern of concentrationPatterns) {
    specification = specification.replace(pattern, (match) => {
      const normalized = match.replace(/\s+/g, '').toLowerCase();
      if (!remarks.some((item) => item.replace(/\s+/g, '').toLowerCase().includes(normalized))) {
        remarks.push(match.trim());
      }
      return ' ';
    });
  }

  specification = specification
    .replace(/^[\s,，;；|+]+|[\s,，;；|+]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { specification, remarks: remarks.join('；') };
}

function normalizeExtractedItem(extracted: Record<string, unknown>, source: 'OCR' | 'VLM'): StructuredResult {
  const riskLevel = (extracted.riskLevel as string) || 'LOW';
  const normalizedRisk = riskLevel === 'MEDIUM' ? 'LOW' : riskLevel === 'CRITICAL' ? 'HIGH' : riskLevel;
  const dangerCategory = (extracted.dangerCategory as string) || '';
  const separated = separateSpecificationRemarks(extracted.specification, extracted.remarks);
  return {
    reagentName: (extracted.reagentName as string) || '',
    casNumber: (extracted.casNumber as string) || '',
    specification: separated.specification,
    remarks: separated.remarks,
    brand: (extracted.brand as string) || '',
    dangerCategory,
    riskLevel: ['LOW', 'HIGH'].includes(normalizedRisk) ? normalizedRisk : 'LOW',
    isHazardous: typeof extracted.isHazardous === 'boolean' ? extracted.isHazardous : Boolean(dangerCategory),
    isControlled: Boolean(extracted.isControlled),
    storageLocation: (extracted.storageLocation as string) || '',
    quantity: Math.max(1, parseInt(String(extracted.quantity ?? '1'), 10) || 1),
    batchNumber: (extracted.batchNumber as string) || '',
    confidence: 0.9,
    source,
    llmStatus: 'ok',
  };
}

/** 兼容既有单条调用方；新的票据入库流程应使用 structureManyWithLLM。 */
export async function structureWithLLM(
  rawData: Record<string, string>,
  source: 'OCR' | 'VLM',
  options?: StructureOptions
): Promise<StructuredResult> {
  const results = await structureManyWithLLM(rawData, source, options);
  return results[0] ?? makeEmptyResult(source, 'parse_error', 'LLM 没有返回任何试剂条目');
}

/**
 * 构造空结果（LLM 调用失败时返回，所有字段为空，仅含状态/错误信息）
 */
function makeEmptyResult(
  source: 'OCR' | 'VLM',
  llmStatus: Exclude<StructuredResult['llmStatus'], 'ok'>,
  llmError: string
): StructuredResult {
  return {
    reagentName: '',
    casNumber: '',
    specification: '',
    remarks: '',
    brand: '',
    dangerCategory: '',
    riskLevel: 'LOW',
    isHazardous: false,
    isControlled: false,
    storageLocation: '',
    quantity: 1,
    batchNumber: '',
    confidence: 0,
    source,
    llmStatus,
    llmError,
  };
}
