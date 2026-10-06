import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ state: { user: null as unknown, isAuthenticated: false, login: vi.fn() } }));
vi.mock('@/store/auth-store', () => ({ useAuthStore: {
  getState: () => fixture.state,
  setState: (patch: object) => Object.assign(fixture.state, patch),
} }));
import { syncAuthSession, clearCachedAuth } from '@/lib/sync-auth-session';
beforeEach(() => {
  fixture.state.user = { id: 'old-platform', role: 'ADMIN', platformRole: 'PLATFORM_ADMIN' };
  fixture.state.isAuthenticated = true;
  fixture.state.login = vi.fn(user => { fixture.state.user = user; fixture.state.isAuthenticated = true; });
});
afterEach(() => vi.unstubAllGlobals());
describe('阻断旧登录缓存导致的跳转循环', () => {
  it('服务器会话失效时清除缓存，不另发 logout 干扰其他登录', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 })); vi.stubGlobal('fetch', fetcher);
    await syncAuthSession();
    expect(fixture.state.user).toBeNull(); expect(fixture.state.isAuthenticated).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('服务器的实验室账号覆盖过期的平台身份', async () => {
    const actual = { id: 'lab-admin', role: 'ADMIN', platformRole: 'PLATFORM_USER' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ user: actual })));
    await syncAuthSession(); expect(fixture.state.user).toEqual(actual);
  });
  it('较早的会话检查不能清除刚完成的新登录', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const pending = syncAuthSession();
    const newUser = { id: 'new-login' }; fixture.state.login(newUser);
    resolve(new Response('{}', { status: 401 })); await pending;
    expect(fixture.state.user).toEqual(newUser);
  });
  it('服务故障抛出可重试错误，不把故障当成角色切换', async () => {
    const original = fixture.state.user;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(syncAuthSession()).rejects.toThrow('重试');
    expect(fixture.state.user).toBe(original);
    clearCachedAuth(); expect(fixture.state.isAuthenticated).toBe(false);
  });
});
