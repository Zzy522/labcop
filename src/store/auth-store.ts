import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
  updateUser: (data: Partial<User>) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      login: (user) => set({ user, isAuthenticated: true }),
      logout: () => {
        // 通知后端清除 HttpOnly Cookie（fire-and-forget，不阻塞 UI）
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {
          /* 忽略网络错误：即使失败也清除前端态 */
        });
        set({ user: null, isAuthenticated: false });
      },
      updateUser: (data) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        })),
    }),
    {
      name: 'lab-safety-auth',
      version: 2, // 版本升级：清除旧的硬编码 demo 用户数据
      // 只持久化 user 和 isAuthenticated
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
