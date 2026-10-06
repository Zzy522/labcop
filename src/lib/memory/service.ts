/**
 * 记忆服务（EntityMemory）
 *
 * 提供「记忆系统」的核心能力：
 * - upsertEntities：将提取的实体写入记忆（按 [userId, entityType, name] 唯一去重，提及次数累加）
 * - searchRelevantEntities：按查询文本匹配相关实体（name/aliases 模糊匹配）
 * - buildEntityContext：构造注入 prompt 的实体上下文文本
 *
 * 记忆分层（整体设计）：
 * - 短期记忆：ChatSession + ChatMessage（会话内多轮对话，已有）
 * - 长期记忆：UserProfile.llmSummary（用户画像周期总结，已有 cron 待启用）
 * - 实体记忆：EntityMemory（专有名词结构化提取，本文件）——精准检索的关键
 */
import { prisma } from '@/lib/prisma';
import type { ExtractedEntity } from './entity-extractor';

/** upsert 实体到记忆（唯一约束 [userId, entityType, name]），单个失败不影响整体 */
export async function upsertEntities(
  userId: string,
  labId: string,
  entities: ExtractedEntity[]
): Promise<number> {
  let saved = 0;
  // 防御：client 未重新 generate 时 entityMemory 不存在，整体跳过
  if (!(prisma as unknown as Record<string, unknown>).entityMemory) {
    return 0;
  }
  for (const e of entities) {
    try {
      await prisma.entityMemory.upsert({
        where: {
          userId_labId_entityType_name: { userId, labId, entityType: e.entityType, name: e.name },
        },
        update: {
          mentionCount: { increment: 1 },
          lastSeenAt: new Date(),
          ...(e.aliases?.length ? { aliases: e.aliases.join(',') } : {}),
          ...(e.attributes ? { attributes: JSON.stringify(e.attributes) } : {}),
        },
        create: {
          userId,
          labId,
          entityType: e.entityType,
          name: e.name,
          aliases: e.aliases?.length ? e.aliases.join(',') : null,
          attributes: e.attributes ? JSON.stringify(e.attributes) : null,
        },
      });
      saved++;
    } catch {
      // ignore single failure
    }
  }
  return saved;
}

export interface RelevantEntity {
  entityType: string;
  name: string;
  aliases: string | null;
  attributes: string | null;
  mentionCount: number;
}

/**
 * 从查询文本中检索相关实体。
 * 策略：取出该用户实体（按重要性排序），做「精准匹配评分」：
 * - 编号类实体（化合物实例 XY-001/GSPT1、CAS 等含字母数字）要求「完整词」出现在 query 中，
 *   避免把 GSPT1 误匹配到 GSPT1-A、或把用户输入的数字串误配多个编号；
 * - 归一化（去连字符/空格/括号）后匹配，XY001 与 XY-001 等价；
 * - 纯中文实体名（课题名/研究方向）保留子串匹配兜底。
 * 实体量小（百级），内存匹配足够快且无需向量。
 */
export async function searchRelevantEntities(
  userId: string,
  labId: string,
  queryText: string,
  limit = 10
): Promise<RelevantEntity[]> {
  if (!queryText.trim()) return [];

  try {
    const all = await prisma.entityMemory.findMany({
      where: { userId, labId },
      orderBy: [{ mentionCount: 'desc' }, { lastSeenAt: 'desc' }],
      take: 500,
      select: { entityType: true, name: true, aliases: true, attributes: true, mentionCount: true },
    });

    const lower = queryText.toLowerCase();
    return all
      .map((e) => ({
        e,
        score: scoreEntityMatch(lower, e.name, e.aliases ? e.aliases.split(',') : []),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.e.mentionCount - a.e.mentionCount)
      .slice(0, limit)
      .map((item) => item.e);
  } catch (e) {
    // 防御：prisma client 未重新 generate（entityMemory 不存在）或表缺失时，跳过实体检索而非报错
    console.warn('[memory] 实体检索失败（需运行 npx prisma generate），已跳过:', e instanceof Error ? e.message : e);
    return [];
  }
}

/** 归一化：小写 + 去分隔符（空格/连字符/下划线/点/括号/顿号），让 XY001 与 XY-001 等价 */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s_\-./()（）·,，、]/g, '');
}

/** 编号类实体（含字母或数字，如 XY-001、GSPT1、ABS-752、CAS 号）需要词边界精准匹配 */
function isIdentifierLike(name: string): boolean {
  return /[a-zA-Z0-9]/.test(name);
}

/** 实体名是否以「完整词」形式出现在 query 中（前后为边界字符或字符串端点） */
function hasWordBoundary(query: string, term: string): boolean {
  const idx = query.indexOf(term.toLowerCase());
  if (idx === -1) return false;
  const before = idx === 0 ? '' : query[idx - 1];
  const after = idx + term.length >= query.length ? '' : query[idx + term.length];
  // 边界 = 非字母/数字（含中文、空格、标点、字符串端点）
  const boundary = /[^a-z0-9]/i;
  return boundary.test(before) && boundary.test(after);
}

/**
 * 实体精准匹配评分（0 = 不匹配）：
 * - 100：精确相等（大小写不敏感）
 * - 90：归一化后相等（忽略分隔符，XY001 ↔ XY-001）
 * - 80：编号类实体以完整词出现在 query 中（词边界，防误配）
 * - 50：纯中文实体名子串命中（query 包含实体名，如课题名）
 * - 40：query 是纯中文实体名的子串（用户输入不完整）
 */
function scoreEntityMatch(query: string, name: string, aliases: string[]): number {
  const qNorm = normalizeForMatch(query);
  const terms = [name, ...aliases]
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  let best = 0;
  for (const term of terms) {
    const tLower = term.toLowerCase();
    if (query === tLower) best = Math.max(best, 100);
    else if (qNorm === normalizeForMatch(tLower)) best = Math.max(best, 90);
    else if (isIdentifierLike(term) && hasWordBoundary(query, tLower)) best = Math.max(best, 80);
  }

  // 纯中文（或含中文）实体名：子串匹配兜底（课题名/研究方向名通常较长，误配率低）
  if (best < 50 && /[\u4e00-\u9fff]/.test(name)) {
    for (const term of terms) {
      const tLower = term.toLowerCase();
      if (!tLower) continue;
      if (query.includes(tLower)) best = Math.max(best, 50);
      else if (tLower.includes(query)) best = Math.max(best, 40);
    }
  }
  return best;
}

/** 构造注入 prompt 的实体上下文文本 */
export function buildEntityContext(entities: RelevantEntity[]): string {
  if (entities.length === 0) return '';

  const typeLabel: Record<string, string> = {
    PERSON: '人名',
    REAGENT: '试剂',
    COMPOUND: '化合物',
    TARGET: '靶点',
    TOPIC: '课题',
    PROJECT: '项目',
    DEVICE: '设备',
    OTHER: '名词',
  };

  const lines = entities.map((e) => {
    let line = `- [${typeLabel[e.entityType] || e.entityType}] ${e.name}`;
    if (e.aliases) line += `（别名：${e.aliases}）`;
    if (e.attributes) {
      try {
        const attrs = JSON.parse(e.attributes) as Record<string, string>;
        const attrStr = Object.entries(attrs)
          .map(([k, v]) => `${k}=${v}`)
          .join('，');
        if (attrStr) line += `：${attrStr}`;
      } catch {
        // ignore
      }
    }
    return line;
  });

  return `相关专有名词记忆（来自历史对话，供你精准理解用户所指）：\n${lines.join('\n')}`;
}
