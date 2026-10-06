import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { AppError, ErrorCategory } from '@/lib/errors';
import { assertSafeExternalUrl } from '@/lib/url-security';

let cachedProxyKey = '';
let cachedProxyAgent: ProxyAgent | null = null;

function getProxySettings(): { proxyUrl: string; noProxy: string } | null {
  const proxyUrl = (
    process.env.LLM_PROXY_URL ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    ''
  ).trim();
  if (!proxyUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new AppError(
      ErrorCategory.CONFIG_MISSING,
      'AI 网络代理地址格式错误，请检查 LLM_PROXY_URL/HTTPS_PROXY 配置'
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AppError(
      ErrorCategory.CONFIG_MISSING,
      'AI 网络代理仅支持 HTTP/HTTPS 协议'
    );
  }

  return {
    proxyUrl: parsed.toString(),
    noProxy: process.env.NO_PROXY || 'localhost,127.0.0.1,::1',
  };
}

function getProxyAgent(settings: { proxyUrl: string; noProxy: string }): ProxyAgent {
  const key = `${settings.proxyUrl}|${settings.noProxy}`;
  if (!cachedProxyAgent || cachedProxyKey !== key) {
    cachedProxyAgent = new ProxyAgent(settings.proxyUrl);
    cachedProxyKey = key;
  }
  return cachedProxyAgent;
}

export function shouldBypassProxy(input: string | URL, noProxy: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(input).hostname.toLowerCase();
  } catch {
    return false;
  }
  return noProxy
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === '*') return true;
      const host = entry.replace(/^\./, '').split(':')[0];
      return hostname === host || hostname.endsWith(`.${host}`);
    });
}

function findErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

export function formatUpstreamNetworkError(error: unknown, usingProxy: boolean): string {
  const code = findErrorCode(error);
  const name = error instanceof Error ? error.name : '';

  if (name === 'AbortError' || name === 'TimeoutError' || code === 'UND_ERR_ABORTED') {
    return 'AI 服务连接超时，请稍后重试';
  }
  if (code === 'ECONNREFUSED' && usingProxy) {
    return 'AI 网络代理不可用，请确认代理程序已启动且代理端口配置正确';
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return 'AI 服务网络访问被拒绝，请检查服务器防火墙或代理配置';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'AI 服务域名解析失败，请检查服务器 DNS 或网络设置';
  }
  if (code === 'ECONNRESET') {
    return 'AI 服务连接被中断，请稍后重试';
  }
  return `AI 服务网络连接失败${code ? `（${code}）` : ''}，请检查网络或代理配置`;
}

/**
 * 服务端上游 AI 请求。
 * LLM_PROXY_URL 优先于通用 HTTPS_PROXY/HTTP_PROXY；未配置代理时保持原生 fetch 行为。
 */
export async function fetchUpstream(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const safeUrl = await assertSafeExternalUrl(input);
  const proxySettings = getProxySettings();
  const usingProxy = Boolean(proxySettings && !shouldBypassProxy(safeUrl, proxySettings.noProxy));
  const safeInit: RequestInit = { ...init, redirect: 'error' };
  try {
    if (!proxySettings || !usingProxy) return await fetch(safeUrl, safeInit);

    const response = await undiciFetch(safeUrl, {
      ...(safeInit as unknown as NonNullable<Parameters<typeof undiciFetch>[1]>),
      dispatcher: getProxyAgent(proxySettings),
    });
    return response as unknown as Response;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      ErrorCategory.NETWORK_ERROR,
      formatUpstreamNetworkError(error, usingProxy),
      { retryable: true, cause: error }
    );
  }
}
