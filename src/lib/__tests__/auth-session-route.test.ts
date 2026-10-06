import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const resolve = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-session', () => ({ resolveSession: resolve }));
import { GET } from '@/app/api/auth/session/route';
describe('当前会话身份接口', () => {
  it('不接受失效会话', async () => {
    resolve.mockResolvedValue(null);
    const response = await GET(new NextRequest('http://localhost/api/auth/session'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('以当前有效成员关系计算角色且不返回密码或令牌', async () => {
    resolve.mockResolvedValue({ tokenHash: 'secret', user: {
      id: 'u1', name: 'A', email: 'a@example.test', role: 'ADMIN', status: 'ACTIVE', platformRole: 'PLATFORM_USER',
      password: 'secret', emailVerified: null, createdAt: new Date(), updatedAt: new Date(),
      labMemberships: [{ labId: 'suspended', role: 'LAB_OWNER', lab: { status: 'SUSPENDED', name: 'old' } }, { labId: 'lab-a', role: 'LAB_MEMBER', lab: { status: 'ACTIVE', name: 'current' } }],
    } });
    const response = await GET(new NextRequest('http://localhost/api/auth/session'));
    const body = await response.json();
    expect(body.user.role).toBe('MEMBER'); expect(body.user.labId).toBe('lab-a');
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
