import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { getEffectiveVlmConfig } from '@/lib/api-config';
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit';
import { sanitizeUserInput } from '@/lib/prompt-security';
import { fetchUpstream } from '@/lib/upstream-fetch';

interface VisionImage {
  name: string;
  dataUrl: string; // data:image/xxx;base64,...
}

const MAX_IMAGES = 5;
const MAX_DATAURL_LEN = 7 * 1024 * 1024; // base64 后约 5MB 原图
const VLM_TIMEOUT_MS = 90_000;

/**
 * POST /api/assistant/vision
 * VLM（视觉语言模型）图片理解接口。
 *
 * 用途：PI 上传图片/PPT 截图/谱图/实验照片，由多模态大模型理解并生成分析/总结。
 *
 * 请求体：
 *   - question: string（必填，对该图的提问/指令）
 *   - images: VisionImage[]（必填，1-5 张，dataUrl 为 base64 data URL）
 *
 * 模型说明：
 *   - 使用当前用户的有效 LLM 配置，需为「视觉模型」（如 gpt-4o / qwen-vl-max / glm-4v / deepseek-vl）
 *   - 若配置的模型不支持 vision，LLM 会报错，接口透传并提示配置 vision 模型
 *
 * 安全：限流（5/min）+ 输入清洗 + 图片大小/数量校验 + 超时。
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 限流（VLM 成本高）
  const rl = checkRateLimit(`${authResult.userId}:vision`, RATE_LIMIT_PRESETS.ocr);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `图片分析请求过于频繁，请 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后再试`, category: 'QUOTA_EXCEEDED' },
      { status: 429 }
    );
  }

  const body = await request.json();
  const question: string = typeof body.question === 'string' ? body.question : '';
  const images: VisionImage[] = Array.isArray(body.images) ? body.images : [];

  if (!question.trim()) {
    return NextResponse.json({ error: '请填写对图片的提问或分析指令' }, { status: 400 });
  }
  if (images.length === 0) {
    return NextResponse.json({ error: '请至少上传一张图片' }, { status: 400 });
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json({ error: `最多上传 ${MAX_IMAGES} 张图片` }, { status: 400 });
  }
  for (const img of images) {
    if (!img.dataUrl || typeof img.dataUrl !== 'string' || !img.dataUrl.startsWith('data:image/')) {
      return NextResponse.json({ error: `图片「${img.name || '未命名'}」格式不正确（需为图片文件）` }, { status: 400 });
    }
    if (img.dataUrl.length > MAX_DATAURL_LEN) {
      return NextResponse.json({ error: `图片「${img.name || '未命名'}」过大（单张不超过 5MB）` }, { status: 400 });
    }
  }

  // 输入清洗
  const sanitized = sanitizeUserInput(question);

  // 获取 VLM 配置（优先独立 vlm 配置，回退到支持 vision 的 LLM 配置）
  const llmConfig = await getEffectiveVlmConfig(authResult.labId, authResult.userId, prisma);
  if (!llmConfig) {
    return NextResponse.json(
      {
        error: 'LLM 未接入：请先在「API 配置」配置支持视觉的模型（如 qwen-vl-max / gpt-4o / glm-4v）',
        actionUrl: authResult.isAdmin ? '/admin/api-config' : '/user/api-config',
        actionText: '前往配置',
      },
      { status: 400 }
    );
  }

  // 组装 OpenAI vision 消息
  const visionContent = [
    { type: 'text', text: sanitized.text },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: img.dataUrl },
    })),
  ];

  const systemPrompt = `你是实验室安全管理系统的图像分析助手，专注于理解实验相关的图片内容（谱图、PPT、实验装置、现象照片、文档截图等）。
你的职责：
1. 准确描述图片中的关键信息（数据、结构、文字、图表趋势）
2. 结合实验室安全/科研语境给出专业解读
3. 若是谱图/结构图，识别关键特征峰、官能团、结构式
4. 若是 PPT/文档截图，提炼要点并结构化总结
5. 涉及安全风险时明确警示
回复要求：使用中文，条理清晰，使用 Markdown 格式。`;

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
          { role: 'system', content: systemPrompt },
          { role: 'user', content: visionContent },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(VLM_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[vision] LLM 调用失败:', resp.status, errText);
      if (resp.status === 401) {
        return NextResponse.json({ error: 'API Key 无效或已过期，请检查配置' }, { status: 401 });
      }
      // 模型不支持 vision 的常见错误
      if (errText.includes('image') || errText.includes('vision') || errText.includes('multimodal') || resp.status === 400) {
        return NextResponse.json(
          { error: '当前配置的模型不支持图片理解（vision）。请在「API 配置」切换为视觉模型（如 qwen-vl-max / gpt-4o / glm-4v）' },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: `图片分析失败（${resp.status}），请稍后重试` }, { status: resp.status >= 500 ? 502 : resp.status });
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content || '未能生成分析结果';

    return NextResponse.json({
      data: {
        content,
        model: llmConfig.model,
        imageCount: images.length,
      },
    });
  } catch (error) {
    console.error('[vision] 调用异常:', error);
    const msg = error instanceof Error && error.name === 'TimeoutError'
      ? '图片分析超时，请重试或减少图片数量'
      : '图片分析服务暂时不可用，请稍后重试';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
});
