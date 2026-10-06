import { AppError, ErrorCategory, Errors } from '@/lib/errors';
import { isRetryableError, withRetry } from '@/lib/retry';
import { fetchUpstream } from '@/lib/upstream-fetch';

export interface VisionInputImage {
  name: string;
  dataUrl: string;
}

interface VisionStreamOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  question: string;
  images: VisionInputImage[];
  onDelta?: (delta: string) => void;
  onStatus?: (status: { stage: 'connecting' | 'retrying' | 'analyzing'; message: string; attempt?: number }) => void;
  signal?: AbortSignal;
}

const VLM_TIMEOUT_MS = 75_000;
const VLM_MAX_ATTEMPTS = 2;

/** 智能体的视觉能力：把图片和用户意图交给已配置的 VLM，并流式返回理解结果。 */
export async function streamVisionAnalysis(options: VisionStreamOptions): Promise<string> {
  let attempt = 0;
  const response = await withRetry(
    () => {
      attempt += 1;
      options.onStatus?.({
        stage: 'connecting',
        message: attempt === 1 ? '正在连接视觉模型…' : `正在进行第 ${attempt} 次视觉模型连接…`,
        attempt,
      });
      const timeoutSignal = AbortSignal.timeout(VLM_TIMEOUT_MS);
      const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
      return fetchUpstream(`${options.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            {
              role: 'system',
              content: `${options.systemPrompt}\n\n你当前已获得用户上传的图片。请直接理解图片并结合用户问题作答，禁止声称“无法查看图片”或“只支持文字”。`,
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: options.question || '请分析上传的图片。' },
                ...options.images.map((image) => ({
                  type: 'image_url',
                  image_url: { url: image.dataUrl },
                })),
              ],
            },
          ],
          temperature: 0.3,
          max_tokens: 2000,
          stream: true,
        }),
        cache: 'no-store',
        signal,
      });
    },
    {
      maxAttempts: VLM_MAX_ATTEMPTS,
      baseDelayMs: 1200,
      maxDelayMs: 3000,
      retryOn: (error) => !options.signal?.aborted && isRetryableError(error),
      onRetry: ({ attempt: failedAttempt, willRetry }) => {
        if (willRetry) {
          options.onStatus?.({
            stage: 'retrying',
            message: `视觉服务暂时未响应，正在自动重试（${failedAttempt}/${VLM_MAX_ATTEMPTS}）…`,
            attempt: failedAttempt,
          });
        }
      },
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw Errors.authInvalid('VLM API Key 无效或已过期，请前往 API 配置检查 VLM 凭证');
    }
    if (response.status === 402 || response.status === 429) {
      throw Errors.quotaExceeded(`VLM API 额度不足或限流（HTTP ${response.status}）`);
    }
    throw new AppError(
      ErrorCategory.UPSTREAM_ERROR,
      `VLM 调用失败（HTTP ${response.status}）：${body.slice(0, 180) || response.statusText}`,
      { httpStatus: 502, retryable: response.status >= 500 }
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw Errors.upstreamError('VLM 返回内容为空', 'VLM');
    options.onDelta?.(content);
    return content;
  }

  const reader = response.body?.getReader();
  if (!reader) throw Errors.upstreamError('VLM 响应流读取失败', 'VLM');
  options.onStatus?.({ stage: 'analyzing', message: '视觉模型已接收图片，正在识别结构与标注…', attempt });

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const parsed = JSON.parse(payload);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (delta) {
        fullContent += delta;
        options.onDelta?.(delta);
      }
    } catch {
      // 单条 SSE 数据损坏时忽略，不中断其余视觉响应。
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      lines.forEach(consumeLine);
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!fullContent) throw Errors.upstreamError('VLM 未生成可用的图片分析结果', 'VLM');
  return fullContent;
}
