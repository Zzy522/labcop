import { useAuthStore } from '@/store/auth-store';
import { AppError, Errors, ErrorCategory, inferCategoryFromHttpStatus } from '@/lib/errors';

/**
 * 带认证的 fetch 封装
 * 认证依赖 HttpOnly Cookie（由浏览器自动携带），不再通过请求头传递用户身份。
 * credentials: 'include' 确保同源/跨域请求都携带 Cookie。
 */
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  }

  let operationStorageKey: string | null = null;
  if (options.method?.toUpperCase() === 'POST' && (['/api/requisitions', '/api/stock-ins/manual'].includes(url) || /^\/api\/reagents\/[^/]+\/adjust$/.test(url)) && !headers.has('Idempotency-Key')) {
    const parts: string[] = [url, useAuthStore.getState().user?.id || ''];
    if (options.body instanceof FormData) {
      for (const [name, value] of options.body.entries()) {
        parts.push(name, typeof value === 'string' ? value : `${value.name}:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await value.arrayBuffer()))).join(',')}`);
      }
    } else parts.push(String(options.body || ''));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parts))))).map(b => b.toString(16).padStart(2, '0')).join('');
    operationStorageKey = `lab-operation:${hash}`;
    // Keep the same key across timeout, page reload and manual retry; clear only on success.
    const key = sessionStorage.getItem(operationStorageKey) || crypto.randomUUID();
    sessionStorage.setItem(operationStorageKey, key);
    headers.set('Idempotency-Key', key);
  }
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (response.ok && operationStorageKey) {
    try { await response.clone().json(); sessionStorage.removeItem(operationStorageKey); }
    catch { /* incomplete response: keep the operation key for a safe replay */ }
  }
  return response;
}

/** authFetchJSON 配置项 */
export interface AuthFetchJSONOptions extends RequestInit {
  /** 超时时间（毫秒），默认 30000；设为 0 表示不超时 */
  timeoutMs?: number;
  /** 自定义 AbortSignal（与 timeoutMs 二选一，优先使用调用方传入的 signal） */
  externalSignal?: AbortSignal;
  /** 是否在失败时自动重试（默认 false，仅对幂等 GET 请求建议开启） */
  retry?: boolean;
  /** 最大重试次数（默认 2，仅在 retry=true 时生效） */
  maxRetries?: number;
}

/**
 * 带用户上下文的 JSON fetch
 * - 内置超时（默认 30s）
 * - 自动解析后端 AppError 结构化错误
 * - 支持 AbortSignal 取消
 * - 失败抛出 AppError（前端可用 showErrorToast 统一展示）
 *
 * @example
 * // 简单调用
 * const data = await authFetchJSON<MyData>('/api/reagents');
 *
 * @example
 * // 带超时和取消
 * const controller = new AbortController();
 * const data = await authFetchJSON<MyData>('/api/slow', {
 *   externalSignal: controller.signal,
 *   timeoutMs: 10000,
 * });
 * // 取消：controller.abort();
 *
 * @example
 * // GET 请求自动重试
 * const data = await authFetchJSON<MyData>('/api/reagents', { retry: true });
 */
export async function authFetchJSON<T = unknown>(
  url: string,
  options: AuthFetchJSONOptions = {}
): Promise<T> {
  const {
    timeoutMs = 30000,
    externalSignal,
    retry = false,
    maxRetries = 2,
    ...fetchOptions
  } = options;

  // 组合 AbortSignal：外部 signal + 超时 signal
  // 若两者都存在，任一触发都会取消请求
  const controller = new AbortController();
  const timeoutId = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

  // 监听外部 signal，转发 abort 到内部 controller
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  const signal = controller.signal;

  const doFetch = async (): Promise<T> => {
    let res: Response;
    try {
      res = await authFetch(url, { ...fetchOptions, signal });
    } catch (err) {
      // 区分超时取消和用户主动取消
      if (err instanceof Error && err.name === 'AbortError') {
        if (externalSignal?.aborted) {
          // 用户主动取消，不视为错误
          throw err;
        }
        // 超时取消
        throw new AppError(
          ErrorCategory.NETWORK_ERROR,
          `请求超时（${timeoutMs / 1000}秒未响应），请检查网络或稍后重试`,
          { cause: err, retryable: true, context: { url, timeoutMs } }
        );
      }
      // 其他网络异常（DNS 失败、连接拒绝等）
      const reason = err instanceof Error ? err.message : String(err);
      throw Errors.networkError(reason);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (!res.ok) {
      // 解析后端 AppError 结构化错误
      let errBody: { error?: string; category?: ErrorCategory; actionUrl?: string; actionText?: string; retryable?: boolean; requestId?: string } = {};
      try {
        errBody = await res.json();
      } catch {
        // 非 JSON 响应（如 502 网关错误返回 HTML）
        errBody = { error: `请求失败 (${res.status})` };
      }

      // 优先用后端返回的 category；否则按 HTTP 状态码推断
      const category = errBody.category ?? inferCategoryFromHttpStatus(res.status);

      throw new AppError(
        category,
        errBody.error || `请求失败 (${res.status})`,
        {
          httpStatus: res.status,
          actionUrl: errBody.actionUrl,
          actionText: errBody.actionText,
          retryable: errBody.retryable ?? [ErrorCategory.NETWORK_ERROR, ErrorCategory.UPSTREAM_ERROR, ErrorCategory.QUOTA_EXCEEDED].includes(category),
          context: { url, status: res.status, requestId: errBody.requestId },
        }
      );
    }

    return res.json();
  };

  if (retry) {
    // 简单重试：仅对可重试错误（网络/5xx/429）重试
    return retryWithBackoff(doFetch, maxRetries);
  }

  return doFetch();
}

/** 简单重试封装（与 src/lib/retry.ts 区别：前端版，不依赖服务端模块） */
async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt === maxRetries;
      const retryable =
        err instanceof AppError ? err.isRetryable : err instanceof Error && err.name === 'AbortError' && !(err as { __userCancelled?: boolean }).__userCancelled;
      if (isLast || !retryable) throw err;
      // 指数退避：500ms, 1000ms, 2000ms...
      const delay = 500 * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
