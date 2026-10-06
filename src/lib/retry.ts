/**
 * 通用重试机制
 *
 * 设计目标：
 * 1. 解决 LLM/OCR 偶发 5xx/429 直接失败导致用户体验差的问题
 * 2. 指数退避 + 抖动，避免 thundering herd
 * 3. 基于 AppError.category 智能判断是否重试（不重试 401/403/配置错误）
 * 4. 支持单次重试预算上限，避免无限重试
 *
 * 关键约束：
 * - 写操作默认不重试（避免重复写入），需显式启用
 * - 重试只对幂等操作安全（GET、纯查询、外部 API 调用）
 */

import { AppError, ErrorCategory, toAppError } from './errors';

export interface RetryOptions {
  /** 最大尝试次数（含首次，默认 3） */
  maxAttempts?: number;
  /** 基础退避延迟（默认 1000ms） */
  baseDelayMs?: number;
  /** 最大退避延迟上限（默认 10000ms） */
  maxDelayMs?: number;
  /** 退避策略：fixed 固定延迟 / exponential 指数退避（默认） */
  backoff?: 'fixed' | 'exponential';
  /** 自定义判断函数：返回 true 才重试（默认按 AppError.isRetryable） */
  retryOn?: (error: unknown, attempt: number) => boolean;
  /** 重试前回调（用于日志/监控） */
  onRetry?: (info: RetryInfo) => void;
  /** 抖动比例 0~1（默认 0.2，避免同步重试风暴） */
  jitter?: number;
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  nextDelayMs: number;
  error: unknown;
  willRetry: boolean;
}

/**
 * 带重试的函数执行器
 *
 * @example
 * // 简单用法：LLM 调用自动重试
 * const result = await withRetry(() => callLLM(prompt), { maxAttempts: 3 });
 *
 * @example
 * // 自定义重试条件
 * const result = await withRetry(() => fetch(url), {
 *   retryOn: (err) => err instanceof AppError && err.category === ErrorCategory.UPSTREAM_ERROR
 * });
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    backoff = 'exponential',
    jitter = 0.2,
    retryOn,
    onRetry,
  } = options;

  if (maxAttempts < 1) {
    throw new Error('withRetry: maxAttempts 必须 >= 1');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === maxAttempts;
      const shouldRetry = isLastAttempt
        ? false
        : retryOn
          ? retryOn(error, attempt)
          : isRetryableError(error);

      const nextDelayMs = computeDelay(attempt, { baseDelayMs, maxDelayMs, backoff, jitter });

      const info: RetryInfo = {
        attempt,
        maxAttempts,
        nextDelayMs,
        error,
        willRetry: shouldRetry,
      };
      onRetry?.(info);

      if (!shouldRetry) {
        throw error;
      }

      await sleep(nextDelayMs);
    }
  }

  // 理论不可达，但 TS 不够聪明
  throw lastError;
}

/**
 * 判断错误是否可重试
 * - AppError：用 isRetryable 字段
 * - 普通 Error：默认不可重试（避免对未知错误盲目重试）
 * - fetch 网络异常（TypeError）：可重试
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AppError) return error.isRetryable;

  // fetch 在网络层失败时抛 TypeError（"fetch failed"）
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }

  // AbortError（超时）可重试一次
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  return false;
}

/** 计算退避延迟 */
function computeDelay(
  attempt: number,
  opts: Required<Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'backoff' | 'jitter'>>
): number {
  const { baseDelayMs, maxDelayMs, backoff, jitter } = opts;

  const base =
    backoff === 'exponential' ? baseDelayMs * Math.pow(2, attempt - 1) : baseDelayMs;

  // 添加抖动：[base * (1 - jitter), base * (1 + jitter)]
  const jitterFactor = 1 + (Math.random() * 2 - 1) * jitter;
  const delay = Math.round(base * jitterFactor);

  return Math.min(delay, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 针对外部 API 调用的预设 ───

/** LLM 调用预设：3 次重试，指数退避 */
export const LLM_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1500,
  maxDelayMs: 12000,
  backoff: 'exponential',
};

/** OCR 调用预设：2 次重试（OCR 任务较重，少重试） */
export const OCR_RETRY: RetryOptions = {
  maxAttempts: 2,
  baseDelayMs: 2000,
  maxDelayMs: 8000,
  backoff: 'exponential',
};

/** PubChem 调用预设：3 次重试，快速退避 */
export const PUBCHEM_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4000,
  backoff: 'exponential',
};

/**
 * HTTP fetch 包装器：内置重试 + 错误分类
 *
 * @example
 * const res = await fetchWithRetry(url, { method: 'POST', body }, {
 *   service: 'LLM',
 *   retryOptions: LLM_RETRY,
 * });
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: {
    service?: string;
    retryOptions?: RetryOptions;
    /** 视为可重试的 HTTP 状态码（默认 [429, 500, 502, 503, 504]） */
    retryableStatuses?: number[];
  } = {}
): Promise<Response> {
  const { service = 'HTTP', retryOptions, retryableStatuses = [429, 500, 502, 503, 504] } = options;

  return withRetry(
    async () => {
      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (err) {
        // 网络层失败
        const reason = err instanceof Error ? err.message : String(err);
        throw new AppError(
          ErrorCategory.NETWORK_ERROR,
          `${service} 网络异常：${reason}`,
          { cause: err, context: { service, url } }
        );
      }

      if (!response.ok && retryableStatuses.includes(response.status)) {
        // 可重试的 HTTP 错误：抛出 AppError 让 withRetry 处理
        const bodyText = await response.text().catch(() => '');
        throw new AppError(
          ErrorCategory.UPSTREAM_ERROR,
          `${service} 调用失败：HTTP ${response.status} - ${bodyText.slice(0, 200) || response.statusText}`,
          {
            httpStatus: response.status,
            retryable: true,
            context: { service, url, status: response.status, bodyPreview: bodyText.slice(0, 500) },
          }
        );
      }

      return response;
    },
    {
      ...retryOptions,
      // 自定义重试判断：只重试网络错误和可重试 HTTP 状态
      retryOn: (err) => {
        if (err instanceof AppError) {
          return err.isRetryable;
        }
        return isRetryableError(err);
      },
    }
  );
}
