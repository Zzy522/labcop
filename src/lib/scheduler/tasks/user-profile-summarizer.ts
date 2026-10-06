/**
 * 定时任务：用户画像周期总结（user-profile-summarizer）
 *
 * 每周日 02:00 扫描已关联实验室的用户，用 LLM 把近 7 天对话总结成画像，
 * 写入 UserProfile.llmSummary（JSON），实现「跨会话记忆」：
 * - 专业领域（expertise）
 * - 沟通风格（communication_style）
 * - 风险偏好（risk_appetite）
 * - 知识缺口（knowledge_gaps）
 * - 建议关注事项（suggested_reminders）
 * - 自然语言概述（free_text_summary）
 *
 * 设计：
 * - 无 LLM 配置的用户跳过（getEffectiveLlmConfig 返回 null）
 * - 无近 7 天对话的用户跳过（避免给空画像）
 * - 单用户失败不影响整体（逐个 try/catch）
 * - 参考旧画像 + 用户纠正说明（userCorrection）实现画像演进
 */
import type { ScheduledTask } from '../types';
import { prisma } from '@/lib/prisma';
import { getEffectiveLlmConfig } from '@/lib/api-config';
import { fetchUpstream } from '@/lib/upstream-fetch';
import { withRetry, LLM_RETRY } from '@/lib/retry';
import type { UserProfileSummary } from '@/lib/memory/user-profile';

/** 画像覆盖的对话窗口（天） */
const DIALOG_WINDOW_DAYS = 7;
/** 单用户对话输入字符上限 */
const DIALOG_CHAR_CAP = 6000;
/** 每用户 LLM 调用超时（毫秒） */
const PROFILE_TIMEOUT_MS = 30_000;
/** 单次任务最多处理用户数（防超时） */
const MAX_USERS_PER_RUN = 200;

const PROFILE_PROMPT = `你是用户画像分析师。根据用户近期对话记录生成/更新一份用户画像，输出严格 JSON 对象（不要 markdown 代码块、不要多余文字）：

{
  "expertise": ["专业领域，如 有机合成、药物化学、细胞培养"],
  "communication_style": "沟通风格，如 简洁直接 / 详细严谨",
  "risk_appetite": "风险偏好，如 谨慎 / 稳健 / 激进",
  "knowledge_gaps": ["知识缺口，如 对某种设备操作不熟"],
  "suggested_reminders": ["建议系统持续关注的提醒事项"],
  "free_text_summary": "150~250 字自然语言画像概述"
}

要求：
1. 专业领域与专有名词只能基于对话中真实出现的内容，保留原始写法（化合物编号/试剂名/课题名/靶点/人名，如 XY-001、GSPT1、抗肿瘤药物合成）
2. 无法判断的字段填 [] 或 "暂无"，不要臆造
3. 参考「历史画像」观察用户演变；尊重「用户纠正说明」优先于旧画像

历史画像（上次总结）：
"""
{{OLD_PROFILE}}
"""

用户的画像纠正说明（用户手动提交）：
"""
{{CORRECTION}}
"""

近期对话记录（近 {{DAYS}} 天）：
"""
{{DIALOG}}
"""

JSON 输出：`;

interface UserToProcess {
  id: string;
  name: string;
  role: string;
  labId: string | null;
}

export const userProfileSummarizerTask: ScheduledTask = {
  name: 'user-profile-summarizer',
  schedule: '0 2 * * 0', // 每周日 02:00（Asia/Shanghai）
  description: '每周总结用户近 7 天对话，更新 UserProfile.llmSummary 画像',
  timeoutMs: 30 * 60 * 1000, // 30 分钟（多用户逐一调用 LLM）
  handler: async () => {
    const since = new Date(Date.now() - DIALOG_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const users: UserToProcess[] = await prisma.user.findMany({
      where: { labId: { not: null }, status: 'ACTIVE' },
      select: { id: true, name: true, role: true, labId: true },
      take: MAX_USERS_PER_RUN,
    });

    // 预取实验室名（用于首次创建 UserProfile.staticProfile）
    const labIds = [...new Set(users.map((u) => u.labId).filter((v): v is string => !!v))];
    const labs = await prisma.lab.findMany({
      where: { id: { in: labIds } },
      select: { id: true, name: true },
    });
    const labNameById = new Map(labs.map((l) => [l.id, l.name]));

    let updated = 0;
    let skipped = 0;
    for (const user of users) {
      try {
        const handled = await summarizeOneUser(user, since, labNameById.get(user.labId ?? '') ?? null);
        if (handled) updated++;
        else skipped++;
      } catch (err) {
        skipped++;
        console.error(`[scheduler] 用户 ${user.name}(${user.id}) 画像总结失败:`, err);
      }
    }

    console.log(`[scheduler] 画像总结完成：更新 ${updated} 人，跳过 ${skipped} 人（共 ${users.length} 人）`);
  },
};

/** 处理单个用户，返回是否成功生成画像 */
async function summarizeOneUser(
  user: UserToProcess,
  since: Date,
  labName: string | null
): Promise<boolean> {
  if (!user.labId) return false;

  const llmConfig = await getEffectiveLlmConfig(user.labId, user.id, prisma);
  if (!llmConfig) return false;

  // 近 7 天对话（用户发出的 user 消息 + 系统为该用户生成的 assistant 消息）
  const messages = await prisma.chatMessage.findMany({
    where: {
      createdAt: { gte: since },
      OR: [{ userId: user.id }, { assistantUserId: user.id }],
    },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true, createdAt: true },
    take: 300,
  });
  if (messages.length === 0) return false;

  const dialog = messages
    .map((m) => {
      const speaker = m.role === 'user' ? '用户' : '助手';
      const time = m.createdAt.toISOString().slice(5, 10);
      return `[${time}] ${speaker}: ${m.content}`;
    })
    .join('\n')
    .slice(0, DIALOG_CHAR_CAP);

  // 读取现有画像 + 用户纠正
  const existing = await prisma.userProfile.findUnique({
    where: { userId: user.id },
    select: { llmSummary: true, userCorrection: true, staticProfile: true },
  });
  const oldProfile = existing?.llmSummary || '（首次生成，无历史画像）';
  const correction = existing?.userCorrection || '（无）';

  const prompt = PROFILE_PROMPT
    .replace('{{OLD_PROFILE}}', oldProfile)
    .replace('{{CORRECTION}}', correction)
    .replace('{{DIALOG}}', dialog)
    .replace('{{DAYS}}', String(DIALOG_WINDOW_DAYS));

  const resp = await withRetry(() => fetchUpstream(`${llmConfig.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${llmConfig.apiKey}`,
    },
    body: JSON.stringify({
      model: llmConfig.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1000,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
  }), LLM_RETRY);

  if (!resp.ok) throw new Error(`画像 LLM 调用失败（${resp.status}）`);
  const data = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content || '';

  const summary = parseProfileOutput(content);
  if (!summary) throw new Error('画像输出无法解析');

  summary.generatedAt = new Date().toISOString();
  const llmSummaryJson = JSON.stringify(summary);

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: {
      llmSummary: llmSummaryJson,
      llmSummaryGeneratedAt: new Date(),
    },
    create: {
      userId: user.id,
      labId: user.labId,
      staticProfile: JSON.stringify({
        role: user.role,
        labName: labName ?? null,
        joinedAt: null,
      }),
      llmSummary: llmSummaryJson,
      llmSummaryGeneratedAt: new Date(),
    },
  });

  return true;
}

/** 容错解析画像 LLM 输出的 JSON 对象 */
function parseProfileOutput(content: string): UserProfileSummary | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const asArray = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
    const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    return {
      expertise: asArray(parsed.expertise),
      communication_style: asString(parsed.communication_style),
      risk_appetite: asString(parsed.risk_appetite),
      knowledge_gaps: asArray(parsed.knowledge_gaps),
      suggested_reminders: asArray(parsed.suggested_reminders),
      free_text_summary: asString(parsed.free_text_summary),
    };
  } catch {
    return null;
  }
}

export default userProfileSummarizerTask;
