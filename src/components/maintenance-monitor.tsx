'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Clock3, X } from 'lucide-react';
import type { MaintenanceSnapshot } from '@/lib/maintenance';

export const MAINTENANCE_CHANNEL = 'lab-copilot-maintenance';
const POLL_INTERVAL_MS = 3_000;

function isMaintenanceBypass(pathname: string) {
  return pathname === '/maintenance' ||
    pathname === '/developer-login' ||
    pathname === '/platform' ||
    pathname.startsWith('/platform/');
}

export function MaintenanceMonitor() {
  const pathname = usePathname();
  const [notice, setNotice] = useState<MaintenanceSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    let redirecting = false;

    const applySnapshot = (snapshot: MaintenanceSnapshot) => {
      if (cancelled || redirecting) return;
      if (snapshot.active && !isMaintenanceBypass(pathname)) {
        redirecting = true;
        window.location.replace('/maintenance');
        return;
      }
      if (pathname === '/maintenance' && !snapshot.active) {
        redirecting = true;
        window.location.replace('/');
        return;
      }
      const noticeIsCurrent = snapshot.lastNotifiedAt && snapshot.estimatedEndAt && new Date(snapshot.estimatedEndAt) > new Date();
      const dismissed = snapshot.lastNotifiedAt && sessionStorage.getItem('maintenance-notice-dismissed') === snapshot.lastNotifiedAt;
      setNotice(noticeIsCurrent && !dismissed ? snapshot : null);
    };

    const check = async () => {
      try {
        const response = await fetch(`/api/system/maintenance?t=${Date.now()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error('维护状态查询失败');
        const body = await response.json();
        if (!body?.data || typeof body.data.active !== 'boolean') throw new Error('维护状态响应无效');
        applySnapshot(body.data as MaintenanceSnapshot);
      } catch {
        // 独立 Nginx 状态在应用重启时仍可读取。
        try {
          const r = await fetch('/maintenance-state.json', { cache: 'no-store' });
          if (!r.ok) return;
          const state = await r.json();
          if (!cancelled && state.enabled && (!state.startsAt || new Date(state.startsAt) <= new Date())) {
            window.location.replace('/maintenance-status');
          }
        } catch { /* unrelated network failure: keep current page */ }
      }
    };

    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(MAINTENANCE_CHANNEL);
    if (channel) {
      channel.onmessage = (event: MessageEvent<MaintenanceSnapshot>) => {
        if (event.data && typeof event.data.active === 'boolean') applySnapshot(event.data);
      };
    }
    const checkWhenVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    void check();
    const timer = window.setInterval(check, POLL_INTERVAL_MS);
    window.addEventListener('focus', checkWhenVisible);
    document.addEventListener('visibilitychange', checkWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', checkWhenVisible);
      document.removeEventListener('visibilitychange', checkWhenVisible);
      channel?.close();
    };
  }, [pathname]);

  if (!notice || notice.active || pathname.startsWith('/maintenance')) return null;
  return <div className="fixed inset-x-0 top-0 z-[100] border-b border-amber-300/30 bg-amber-950/95 px-4 py-2.5 text-amber-50 shadow-xl backdrop-blur">
    <div className="mx-auto flex max-w-7xl items-center gap-3 text-sm"><Clock3 className="size-4 shrink-0 text-amber-300"/><p className="min-w-0 flex-1"><strong>{notice.title}</strong><span className="ml-2 text-amber-100/75">{notice.message}　预计完成：{new Date(notice.estimatedEndAt!).toLocaleString('zh-CN')}</span></p><button type="button" aria-label="关闭维护通知" onClick={()=>{if(notice.lastNotifiedAt)sessionStorage.setItem('maintenance-notice-dismissed',notice.lastNotifiedAt);setNotice(null);}} className="rounded p-1 text-amber-200 hover:bg-white/10"><X className="size-4"/></button></div>
  </div>;
}
