import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { getEffectiveLlmConfig } from '@/lib/api-config';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { fetchUpstream } from '@/lib/upstream-fetch';

const optimizeSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
});

const SYSTEM_PROMPT =
  '你是实验室安全通告文案优化助手。请优化用户提供的通告标题和正文，使其更专业、清晰、易读。只能返回符合 schema 的纯 JSON 对象，禁止包含任何 markdown 代码块、注释、解释文字。';

const USER_PROMPT_TEMPLATE = `请优化以下实验室通告文案，使其更专业、清晰、易读，符合实验室管理规范。

【原标题】
{title}

【原正文】
{content}

【优化要求】
1. 标题简明扼要，不超过 30 字，突出通告核心事项
2. 正文结构清晰，可用换行分段，但不要使用 markdown 标记
3. 语言专业、正式、有礼貌，避免口语化
4. 如涉及安全检查/扫除等，明确时间、要求、责任人等要素
5. 保留原文所有关键信息，不编造新内容

【输出 Schema】必须返回纯 JSON：
{
  "title": "优化后的标题",
  "content": "优化后的正文"
}`;

/**
 * POST /api/announcements/optimize
 * 管理员调用 LLM 优化通告文案（不持久化，仅返回优化后的文本供前端预览）
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  const body = await request.json();
  const parsed = optimizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '参数错误' },
      { status: 400 }
    );
  }

  const llmConfig = await getEffectiveLlmConfig(authResult.labId, authResult.userId, prisma);
  if (!llmConfig) {
    return NextResponse.json(
      {
        error: 'LLM 未接入：未配置 LLM API 凭证。请前往「API 配置」页面配置 LLM 后再试。',
        actionUrl: '/admin/api-config',
      },
      { status: 400 }
    );
  }

  const prompt = USER_PROMPT_TEMPLATE
    .replace('{title}', parsed.data.title)
    .replace('{content}', parsed.data.content);

  let response: Response;
  try {
    response = await fetchUpstream(`${llmConfig.baseUrl}/chat/completions`, {
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
        temperature: 0.5,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
      cache: 'no-store',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `LLM 网络异常：${msg}` },
      { status: 502 }
    );
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    let llmError: string;
    if (response.status === 401) {
      llmError = 'LLM API Key 无效（HTTP 401），请检查 API Key 配置';
    } else if (response.status === 402 || response.status === 429) {
      llmError = `LLM API 额度不足或限流（HTTP ${response.status}），请稍后重试或更换 Key`;
    } else {
      llmError = `LLM API 调用失败：HTTP ${response.status}`;
    }
    console.error(`[Announcement LLM] ${llmError}`, errBody.slice(0, 200));
    return NextResponse.json({ error: llmError }, { status: 502 });
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    return NextResponse.json(
      { error: 'LLM 返回为空，请稍后重试' },
      { status: 502 }
    );
  }

  // 解析 JSON（容忍 markdown 代码块）
  let optimized: { title?: string; content?: string };
  try {
    optimized = JSON.parse(content);
  } catch {
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      optimized = JSON.parse(match[1].trim());
    } else {
      const start = content.indexOf('{');
      const end = content.lastIndexOf('}');
      if (start !== -1 && end !== -1) {
        optimized = JSON.parse(content.substring(start, end + 1));
      } else {
        return NextResponse.json(
          { error: 'LLM 返回内容无法解析，请稍后重试或修改原文后重试' },
          { status: 502 }
        );
      }
    }
  }

  if (!optimized.title || !optimized.content) {
    return NextResponse.json(
      { error: 'LLM 返回内容缺失标题或正文' },
      { status: 502 }
    );
  }

  return NextResponse.json({
    data: {
      title: optimized.title,
      content: optimized.content,
    },
  });
});
