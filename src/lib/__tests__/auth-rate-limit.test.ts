import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/auth-rate-limit';

describe('受信任代理客户端 IP 提取', () => {
  it('忽略攻击者可控的 X-Forwarded-For 首段', () => {
    const request = new NextRequest('http://localhost/api/auth/login', {
      headers: {
        'x-forwarded-for': '198.51.100.99, 203.0.113.10',
        'x-real-ip': '203.0.113.10',
      },
    });
    expect(getClientIp(request)).toBe('203.0.113.10');
  });

  it('缺失或伪造为非 IP 时落入统一的 fail-closed 桶', () => {
    expect(getClientIp(new NextRequest('http://localhost/api/auth/login'))).toBe('unknown');
    expect(getClientIp(new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-real-ip': 'attacker-controlled' },
    }))).toBe('unknown');
  });
});
