import { prisma } from '@/lib/prisma';
import { getEffectiveOcrToken, OCR_CONFIG } from '@/lib/api-config';
import { AppError, Errors, ErrorCategory } from '@/lib/errors';
import { withRetry, OCR_RETRY } from '@/lib/retry';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120000; // 120 秒

export interface PaddleOCRAuthContext {
  labId?: string;
  userId: string;
}

export interface PaddleOCRResult {
  /** 拼接后的 Markdown 文本 */
  text: string;
  /** 原始 JSON 文本（API 完整响应，可用于调试） */
  rawText: string;
}

/**
 * 安全 fetch：捕获网络错误，附加状态码与响应体到错误信息
 * 注意：仅对提交/查询接口的非可重试错误立即抛出，
 *      轮询中的瞬时网络错误由调用方处理
 */
async function safeFetch(
  url: string,
  init: RequestInit,
  contextLabel: string
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw Errors.networkError(`${contextLabel}：${reason}`, 'OCR');
  }

  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      // 忽略读取失败
    }
    const snippet = bodyText.slice(0, 200) || response.statusText;
    // 401/403 → AUTH_INVALID；429 → QUOTA_EXCEEDED；5xx → UPSTREAM_ERROR（可重试）
    const category =
      response.status === 401 || response.status === 403
        ? ErrorCategory.AUTH_INVALID
        : response.status === 429
          ? ErrorCategory.QUOTA_EXCEEDED
          : response.status >= 500
            ? ErrorCategory.UPSTREAM_ERROR
            : ErrorCategory.UPSTREAM_ERROR;
    throw new AppError(
      category,
      `${contextLabel}：HTTP ${response.status} - ${snippet}`,
      {
        httpStatus: response.status,
        retryable: category === ErrorCategory.UPSTREAM_ERROR || category === ErrorCategory.QUOTA_EXCEEDED,
        context: { service: 'OCR', url, status: response.status, bodyPreview: bodyText.slice(0, 500) },
      }
    );
  }

  return response;
}

/**
 * 服务端 PaddleOCR 调用（直接执行，不通过 HTTP API）
 *
 * 流程：
 * 1. 从 ApiCredential 获取 OCR Token（优先级：个人配置 > 实验室统一配置）
 * 2. POST 提交图片到 PaddleOCR jobs API
 * 3. 轮询任务状态（最多 120 秒，每 3 秒一次）
 * 4. 获取 JSON 结果，从 result.layoutParsingResults[].markdown.text 提取文本
 *
 * 返回：{ text: 拼接后的 markdown, rawText: 原始 JSON }
 * 字段提取由 LLM 完成（不再使用正则降级），LLM 未配置时调用方应直接报错。
 *
 * @throws Error 当未配置 Token、文件无效、或 OCR 服务失败时抛出
 */
export async function runPaddleOCR(
  file: File,
  authContext: PaddleOCRAuthContext
): Promise<PaddleOCRResult> {
  // 1. 获取有效的 OCR Token
  const ocrConfig = await getEffectiveOcrToken(authContext.labId, authContext.userId, prisma);
  if (!ocrConfig) {
    throw Errors.configMissing(
      '尚未配置 PaddleOCR API Token，请在「API 配置」页面配置 OCR 凭证',
      '/user/api-config',
      '前往配置 OCR'
    );
  }

  // 2. 校验文件
  if (!file.type.startsWith('image/')) {
    throw Errors.validationError('只支持图片类型文件');
  }
  if (file.size > MAX_FILE_SIZE) {
    throw Errors.validationError(`图片大小不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  const jobUrl = OCR_CONFIG.paddleocr.jobUrl;
  const model = OCR_CONFIG.paddleocr.model;
  const authHeader = `bearer ${ocrConfig.token}`;

  // 3. 提交 OCR 任务（带重试：网络异常/5xx 自动重试）
  const submitForm = new FormData();
  submitForm.append('model', model);
  submitForm.append(
    'optionalPayload',
    JSON.stringify({
      useDocOrientationClassify: false,
      useDocUnwarping: false,
      useChartRecognition: false,
    })
  );
  submitForm.append('file', file, file.name);

  // 提交任务用 withRetry 包装 safeFetch：仅对可重试错误（网络/5xx/429）重试
  const submitRes = await withRetry(
    () =>
      safeFetch(
        jobUrl,
        {
          method: 'POST',
          headers: { Authorization: authHeader },
          body: submitForm,
          cache: 'no-store',
        },
        'OCR 任务提交失败'
      ),
    {
      ...OCR_RETRY,
      onRetry: (info) => {
        console.warn(`[OCR] 提交任务第 ${info.attempt} 次失败，${info.willRetry ? `将在 ${info.nextDelayMs}ms 后重试` : '不再重试'}`, info.error);
      },
    }
  );

  const submitData = await submitRes.json().catch(() => null);
  const jobId: string | undefined =
    submitData?.data?.jobId || submitData?.jobId || submitData?.data?.id;
  if (!jobId) {
    throw Errors.upstreamError('OCR 任务提交失败：未返回任务 ID', 'OCR');
  }

  // 4. 轮询任务状态
  const statusUrl = `${jobUrl}/${jobId}`;
  const startTime = Date.now();
  let jsonUrl: string | null = null;
  let state: string | undefined;
  let lastError: string | null = null;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const statusRes = await fetch(statusUrl, {
        method: 'GET',
        headers: { Authorization: authHeader },
        cache: 'no-store',
      });

      if (!statusRes.ok) {
        // 临时性错误，记录后继续轮询
        lastError = `HTTP ${statusRes.status}`;
        continue;
      }

      const statusData = await statusRes.json();
      const data = statusData?.data || statusData;
      state = data?.state;
      const resultUrl = data?.resultUrl;
      jsonUrl =
        typeof resultUrl === 'string'
          ? resultUrl
          : resultUrl?.jsonUrl || null;

      if (state === 'done') break;
      if (state === 'failed') {
        const errorMsg = data?.error || data?.errorMsg || '未知错误';
        throw Errors.upstreamError(`OCR 识别失败：${errorMsg}`, 'OCR');
      }
      // pending / running → 继续轮询
    } catch (err) {
      // 如果是已知的业务错误（failed/upstream），直接抛出
      if (err instanceof AppError && err.category !== ErrorCategory.NETWORK_ERROR) {
        throw err;
      }
      // 网络错误，记录后继续重试
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (state !== 'done') {
    throw Errors.upstreamError(
      `OCR 识别超时（最后状态：${state ?? '未知'}${lastError ? `，错误：${lastError}` : ''}），请稍后重试`,
      'OCR'
    );
  }

  // 5. 获取 JSONL 结果
  if (!jsonUrl) {
    throw Errors.upstreamError('OCR 识别失败：未返回结果地址', 'OCR');
  }

  // 注意：resultUrl 通常是带签名的公开 CDN/OSS URL，不应带 Authorization header
  // 带上 token 反而可能被 CDN 拒绝（导致 "OCR 结果获取失败"）
  let resultRes: Response;
  try {
    resultRes = await fetch(jsonUrl, { cache: 'no-store' });
    // 若带签名 URL 失败，回退尝试带 Authorization header
    if (!resultRes.ok && resultRes.status === 401) {
      resultRes = await fetch(jsonUrl, {
        headers: { Authorization: authHeader },
        cache: 'no-store',
      });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw Errors.networkError(`OCR 结果获取失败：${reason}`, 'OCR');
  }

  if (!resultRes.ok) {
    const bodyText = await resultRes.text().catch(() => '');
    throw new AppError(
      ErrorCategory.UPSTREAM_ERROR,
      `OCR 结果获取失败：HTTP ${resultRes.status} - ${bodyText.slice(0, 200) || resultRes.statusText}`,
      {
        httpStatus: resultRes.status,
        retryable: resultRes.status >= 500,
        context: { service: 'OCR', url: jsonUrl, status: resultRes.status },
      }
    );
  }

  const rawText = await resultRes.text();

  // 解析 OCR 结果：优先按单个 JSON 对象解析（PaddleOCR-VL 官方返回格式）
  // 回退到 JSONL（每行一个 JSON）以兼容旧版/其他端点
  // 关键字段路径：
  //   - result.layoutParsingResults[].markdown.text  （PaddleOCR-VL 标准格式）
  //   - result[].markdown.text                       （部分旧版顶层为数组）
  //   - markdownText                                  （CLI 简化格式）
  const markdownTexts: string[] = [];

  const tryExtract = (obj: unknown): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    const root = obj as Record<string, unknown>;

    // 路径 1：result.layoutParsingResults[].markdown.text
    const result = root.result as Record<string, unknown> | undefined;
    const layoutResults =
      (result?.layoutParsingResults as Array<Record<string, unknown>> | undefined) ??
      (Array.isArray(result) ? (result as Array<Record<string, unknown>>) : undefined);
    if (Array.isArray(layoutResults)) {
      for (const item of layoutResults) {
        const md = (item?.markdown as Record<string, unknown> | undefined)?.text;
        if (typeof md === 'string' && md.trim()) markdownTexts.push(md);
        // 兼容字段名 markdownText
        const mdText = item?.markdownText;
        if (typeof mdText === 'string' && mdText.trim()) markdownTexts.push(mdText);
      }
    }

    // 路径 2：顶层 markdownText（CLI 简化格式）
    if (typeof root.markdownText === 'string' && root.markdownText.trim()) {
      markdownTexts.push(root.markdownText);
    }

    // 路径 3：顶层 markdown.text
    const topMd = root.markdown as Record<string, unknown> | undefined;
    if (typeof topMd?.text === 'string' && topMd.text.trim()) {
      markdownTexts.push(topMd.text);
    }

    return markdownTexts.length > 0;
  };

  // 优先：整体 JSON.parse（API 返回单对象的标准情况）
  let parsed = false;
  try {
    const obj = JSON.parse(rawText);
    parsed = tryExtract(obj);
  } catch {
    // 不是单个 JSON，尝试 JSONL
  }

  // 回退：JSONL（每行一个 JSON 对象）
  if (!parsed) {
    const lines = rawText.split('\n').filter((l) => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        tryExtract(obj);
      } catch {
        // 跳过无法解析的行
      }
    }
  }

  const text = markdownTexts.join('\n\n');
  if (!text.trim()) {
    // 提供原始响应片段便于调试
    const snippet = rawText.slice(0, 500).replace(/\s+/g, ' ');
    throw Errors.parseError(
      `OCR 识别完成但未提取到任何文本。原始响应片段：${snippet}${rawText.length > 500 ? '...' : ''}`,
      rawText
    );
  }

  // 调试日志：便于排查 OCR 提取效果（在 dev server 控制台可见）
  console.log(
    `[PaddleOCR] 提取完成：text 长度=${text.length}，` +
      `text 片段=${text.slice(0, 200).replace(/\s+/g, ' ')}`
  );

  return { text, rawText };
}
