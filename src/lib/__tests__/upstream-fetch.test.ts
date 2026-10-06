import { describe, expect, it } from 'vitest';
import { formatUpstreamNetworkError, shouldBypassProxy } from '@/lib/upstream-fetch';

describe('formatUpstreamNetworkError', () => {
  it('explains a refused local proxy', () => {
    const error = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    expect(formatUpstreamNetworkError(error, true)).toContain('代理不可用');
  });

  it('explains denied direct network access', () => {
    const error = new TypeError('fetch failed', { cause: { code: 'EACCES' } });
    expect(formatUpstreamNetworkError(error, false)).toContain('网络访问被拒绝');
  });

  it('explains DNS failures without exposing raw internals', () => {
    const error = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    expect(formatUpstreamNetworkError(error, false)).toContain('域名解析失败');
    expect(formatUpstreamNetworkError(error, false)).not.toContain('fetch failed');
  });
});

describe('shouldBypassProxy', () => {
  it('supports exact hosts and domain suffixes', () => {
    expect(shouldBypassProxy('https://api.deepseek.com/chat/completions', 'localhost,.deepseek.com')).toBe(true);
    expect(shouldBypassProxy('https://example.com', 'localhost,.deepseek.com')).toBe(false);
  });
});
