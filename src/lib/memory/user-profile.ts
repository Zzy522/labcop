/**
 * 用户画像（长期记忆）读取与格式化
 *
 * 画像数据来源：UserProfile.llmSummary（由 user-profile-summarizer 定时任务每周生成）。
 * 作用：把跨会话的用户背景（专业领域/沟通风格/风险偏好/知识缺口）注入助手 system 上下文，
 * 让助手无需用户重复介绍即可精准适配（如"这位用户主攻有机合成"）。
 */
import type { PrismaClient } from '@/generated/prisma/client';

export interface UserProfileSummary {
  expertise?: string[];
  communication_style?: string;
  risk_appetite?: string;
  knowledge_gaps?: string[];
  suggested_reminders?: string[];
  free_text_summary?: string;
  generatedAt?: string;
}

/** 解析 llmSummary JSON，失败返回 null */
export function parseUserProfileSummary(raw: string | null | undefined): UserProfileSummary | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const asArray = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
    const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const result: UserProfileSummary = {
      expertise: asArray(parsed.expertise),
      communication_style: asString(parsed.communication_style),
      risk_appetite: asString(parsed.risk_appetite),
      knowledge_gaps: asArray(parsed.knowledge_gaps),
      suggested_reminders: asArray(parsed.suggested_reminders),
      free_text_summary: asString(parsed.free_text_summary),
      generatedAt: asString(parsed.generatedAt),
    };
    // 至少有一个有效字段才算有效画像
    const hasContent =
      (result.expertise?.length ?? 0) > 0 ||
      (result.knowledge_gaps?.length ?? 0) > 0 ||
      (result.suggested_reminders?.length ?? 0) > 0 ||
      !!result.communication_style ||
      !!result.risk_appetite ||
      !!result.free_text_summary;
    return hasContent ? result : null;
  } catch {
    return null;
  }
}

/**
 * 读取当前用户的画像并格式化为可注入 system 的文本。
 * 画像不存在/未生成/解析失败时返回空字符串（不注入）。
 */
export async function loadUserProfileContext(
  userId: string,
  prisma: PrismaClient,
  labId: string,
): Promise<string> {
  try {
    const profile = await prisma.userProfile.findFirst({
      where: { userId, labId },
      select: { llmSummary: true },
    });
    const parsed = parseUserProfileSummary(profile?.llmSummary);
    if (!parsed) return '';

    const lines: string[] = ['用户画像（来自对历史对话的周期总结，供你了解用户背景与偏好）：'];
    if (parsed.expertise?.length) lines.push(`- 专业领域：${parsed.expertise.join('、')}`);
    if (parsed.communication_style) lines.push(`- 沟通风格：${parsed.communication_style}`);
    if (parsed.risk_appetite) lines.push(`- 风险偏好：${parsed.risk_appetite}`);
    if (parsed.knowledge_gaps?.length) lines.push(`- 已知知识缺口：${parsed.knowledge_gaps.join('、')}`);
    if (parsed.suggested_reminders?.length) lines.push(`- 建议关注事项：${parsed.suggested_reminders.join('、')}`);
    if (parsed.free_text_summary) lines.push(`- 概述：${parsed.free_text_summary}`);
    return lines.join('\n');
  } catch {
    return '';
  }
}
