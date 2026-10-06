'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Clock3, CheckCircle2, XCircle, FlaskConical } from 'lucide-react';

type StatusData = { userStatus: string; application: null | { id: string; type: string; status: string; requestedRole: string; labName: string | null; reviewComment: string | null; submittedAt: string; reviewedAt: string | null } };

export default function ApplicationStatusPage() {
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void fetch('/api/auth/application-status').then(async (res) => { const body = await res.json(); if (!res.ok) throw new Error(body.error); setData(body.data); }).catch((e) => setError(e instanceof Error ? e.message : '加载失败')); }, []);
  const status = data?.application?.status;
  const Icon = status === 'APPROVED' ? CheckCircle2 : status === 'REJECTED' ? XCircle : Clock3;
  return <main className="flex min-h-screen items-center justify-center bg-[#050914] p-6 text-slate-200">
    <section className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#0a101a] p-8 shadow-2xl">
      <div className="mb-7 flex items-center gap-3"><span className="flex size-11 items-center justify-center rounded-xl bg-teal-400/10"><FlaskConical className="text-teal-300" /></span><div><h1 className="text-xl font-semibold text-white">账号申请状态</h1><p className="text-sm text-slate-500">Lab Copilot 审批中心</p></div></div>
      {error ? <p className="rounded-xl bg-rose-500/10 p-4 text-rose-300">{error}</p> : !data ? <p className="text-slate-500">正在查询…</p> : <div className="space-y-5">
        <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-5"><Icon className="mt-0.5 text-teal-300" /><div><p className="font-medium text-white">{status === 'APPROVED' ? '审批已通过' : status === 'REJECTED' ? '申请未通过' : status === 'NEEDS_INFO' ? '需要补充材料' : '正在等待审批'}</p><p className="mt-1 text-sm text-slate-400">{data.application?.type === 'CREATE_LAB' ? '新实验室与首位实验室负责人申请' : '加入实验室账号申请'} · {data.application?.labName || '待确认实验室'}</p></div></div>
        {data.application?.reviewComment && <div><p className="text-xs uppercase tracking-wider text-slate-600">审批意见</p><p className="mt-2 rounded-xl bg-white/[0.03] p-4 text-sm text-slate-300">{data.application.reviewComment}</p></div>}
        <p className="text-xs leading-6 text-slate-500">审批通过后当前会话会被自动吊销，请重新登录。新实验室由平台管理员审批；加入已有实验室由该实验室 实验室总管理员 审批。</p>
      </div>}
      <Link href="/login" className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-teal-300 px-5 text-sm font-semibold text-slate-950 hover:bg-teal-200">返回登录</Link>
    </section>
  </main>;
}
