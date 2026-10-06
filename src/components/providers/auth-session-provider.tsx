'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { syncAuthSession } from '@/lib/sync-auth-session';

/** Delay all page guards until persisted identity has been checked against the server. */
export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void syncAuthSession().then(() => { if (!cancelled) setReady(true); }).catch(error => {
      if (!cancelled) setError(error instanceof Error ? error.message : '验证登录状态失败');
    });
    return () => { cancelled = true; };
  }, [attempt]);
  if (ready || pathname === '/maintenance') return children;
  return <div className="flex min-h-dvh flex-col items-center justify-center gap-4 text-sm text-slate-600" role="status">
    <p>{error || '正在核实登录状态…'}</p>
    {error && <button type="button" className="rounded-lg border px-4 py-2" onClick={() => { setError(''); setAttempt(value => value + 1); }}>重试</button>}
  </div>;
}
