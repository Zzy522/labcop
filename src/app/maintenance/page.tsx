'use client';

import { useEffect, useState } from 'react';
import { Clock3, FlaskConical, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { MaintenanceSnapshot } from '@/lib/maintenance';

export default function MaintenancePage() {
  const [snapshot, setSnapshot] = useState<MaintenanceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const response = await fetch('/api/system/maintenance', { cache: 'no-store' });
      const body = await response.json();
      setSnapshot(body.data);
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050914] px-5 py-12 text-slate-200">
    <div className="absolute left-1/2 top-1/2 size-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-teal-400/10 blur-[120px]"/>
    <section className="relative w-full max-w-xl rounded-[32px] border border-white/10 bg-[#0a121e]/90 p-8 text-center shadow-2xl backdrop-blur sm:p-12">
      <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-teal-300 text-slate-950 shadow-lg shadow-teal-950/30"><FlaskConical className="size-8"/></div>
      {loading ? <div className="mt-10 flex justify-center"><Loader2 className="size-6 animate-spin text-teal-300"/></div> : <>
        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.25em] text-teal-300">System maintenance</p>
        <h1 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">{snapshot?.title || 'Lab Copilot 升级中'}</h1>
        <p className="mx-auto mt-5 max-w-md leading-7 text-slate-400">{snapshot?.message || '我们正在进行系统升级，请稍后再试。'}</p>
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <p className="flex items-center justify-center gap-2 text-sm text-slate-500"><Clock3 className="size-4 text-amber-300"/>预计完成时间</p>
          <p className="mt-2 text-lg font-medium text-white">{snapshot?.estimatedEndAt ? new Date(snapshot.estimatedEndAt).toLocaleString('zh-CN') : '请留意平台通知'}</p>
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600"><span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5"/>维护期间数据保持安全</span><span className="flex items-center gap-1.5"><RefreshCw className="size-3.5"/>页面每 15 秒自动检测恢复</span></div>
      </>}
    </section>
  </main>;
}
