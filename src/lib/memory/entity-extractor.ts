/**
 * 实体提取器（NER）
 *
 * 用 LLM 从对话文本中提取专有名词实体，输出结构化 JSON。
 * 提取的实体用于「记忆系统」：结构化存储 + 精准检索 + 注入后续对话上下文。
 *
 * 设计：
 * - 低温（temperature=0）保证输出稳定可解析
 * - 严格 JSON 数组输出，容错解析（剥离 markdown 代码块）
 * - 失败静默返回 []（不阻塞主对话流程）
 */
import { getEffectiveLlmConfig } from '@/lib/api-config';
import type { PrismaClient } from '@/generated/prisma/client';
import { fetchUpstream } from '@/lib/upstream-fetch';

export interface ExtractedEntity {
  entityType: string; // PERSON | REAGENT | COMPOUND | TARGET | TOPIC | PROJECT | DEVICE | OTHER
  name: string;
  aliases?: string[];
  attributes?: Record<string, string>;
}

const EXTRACT_PROMPT = `你是实体抽取器。从下面的对话文本中提取专有名词实体，输出严格的 JSON 数组。

实体类型（entityType）：
- PERSON：人名（如 张三、李老师）
- REAGENT：试剂名（如 浓硫酸、乙酸乙酯）
- COMPOUND：化合物名/编号（如 XY-001、阿司匹林）
- TARGET：靶点/细胞系/蛋白名（如 A549、EGFR、COX-2）
- TOPIC：课题/研究方向名（如 抗肿瘤药物合成）
- PROJECT：项目名
- DEVICE：设备名（如 高效液相色谱仪）
- OTHER：其他明确专有名词

要求：
1. 只提取明确出现的专有名词；泛化词（单独出现的"试剂""设备""课题"）不算
2. name 用规范化全称
3. aliases 列出别名/缩写（如有）
4. attributes 提取结构化属性（如试剂的CAS号、化合物的靶点、人的角色），无则省略该字段
5. 只输出 JSON 数组，不要任何解释、不要用 markdown 代码块包裹之外的文字
6. 若无实体，输出 []

对话文本：
"""
{{TEXT}}
"""

JSON 数组输出：`;

/** 从文本中提取实体，失败返回 [] */
export async function extractEntities(
  text: string,
  labId: string | undefined,
  userId: string,
  prisma: PrismaClient
): Promise<ExtractedEntity[]> {
  const trimmed = text.trim();
  if (trimmed.length < 5) return [];

  const llmConfig = await getEffectiveLlmConfig(labId, userId, prisma);
  if (!llmConfig) return [];

  try {
    const resp = await fetchUpstream(`${llmConfig.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${llmConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'user', content: EXTRACT_PROMPT.replace('{{TEXT}}', trimmed.slice(0, 4000)) },
        ],
        temperature: 0,
        max_tokens: 800,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content || '';
    return parseEntitiesJson(content);
  } catch {
    return [];
  }
}

/** 容错解析 LLM 输出的 JSON 数组 */
function parseEntitiesJson(content: string): ExtractedEntity[] {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr: unknown = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (e): e is { entityType: unknown; name: unknown; aliases?: unknown; attributes?: unknown } =>
          !!e && typeof e === 'object' && typeof (e as { name?: unknown }).name === 'string'
      )
      .map((e) => ({
        entityType: String(e.entityType).toUpperCase(),
        name: String(e.name).trim(),
        aliases: Array.isArray(e.aliases) ? e.aliases.map(String) : undefined,
        attributes:
          e.attributes && typeof e.attributes === 'object'
            ? (e.attributes as Record<string, string>)
            : undefined,
      }))
      .filter((e) => e.name.length > 0 && e.name.length < 100 && e.entityType.length < 20);
  } catch {
    return [];
  }
}
