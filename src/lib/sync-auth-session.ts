import { useAuthStore } from '@/store/auth-store';
import type { User } from '@/types';

export function clearCachedAuth() {
  // Do not fire a logout request: a different tab may have established a valid session.
  useAuthStore.setState({ user: null, isAuthenticated: false });
}

export async function syncAuthSession(): Promise<void> {
  const previousUser = useAuthStore.getState().user;
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
  if (response.status === 401) {
    if (useAuthStore.getState().user === previousUser) clearCachedAuth();
    return;
  }
  if (!response.ok) throw new Error('暂时无法验证登录状态，请检查本地服务后重试');
  const body = await response.json() as { user?: User };
  if (!body.user?.id) throw new Error('登录状态响应无效，请重试');
  // An older request must never overwrite a login completed while it was in flight.
  if (useAuthStore.getState().user === previousUser) useAuthStore.getState().login(body.user);
}
