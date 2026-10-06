'use client';

import { FormEvent, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, FlaskConical, GraduationCap, Loader2, ShieldCheck, UserRound } from 'lucide-react';

type FormState = {
  accountType: 'LAB_ADMIN' | 'LAB_MEMBER'; name: string; email: string; phone: string; password: string;
  institutionType: 'UNIVERSITY' | 'ENTERPRISE'; schoolName: string; collegeName: string; academicIdentity: 'TEACHER' | 'STUDENT';
  companyName: string; companyIdentity: string; mode: 'CREATE' | 'JOIN'; labName: string; labLocation: string; joinCode: string; message: string; code: string;
};

const initial: FormState = { accountType: 'LAB_MEMBER', name: '', email: '', phone: '', password: '', institutionType: 'UNIVERSITY', schoolName: '', collegeName: '', academicIdentity: 'STUDENT', companyName: '', companyIdentity: '', mode: 'JOIN', labName: '', labLocation: '', joinCode: '', message: '', code: '' };
const inputClass = 'h-11 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-teal-300/60 focus:ring-2 focus:ring-teal-300/10';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [verifyToken, setVerifyToken] = useState('');
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [captcha, setCaptcha] = useState({ id: '', url: '', answer: '' });
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((old) => ({ ...old, [key]: value }));

  const refreshCaptcha = useCallback(async () => {
    const res = await fetch('/api/auth/captcha', { cache: 'no-store' });
    const data = await res.json();
    if (res.ok) setCaptcha({ id: data.id, url: data.imageUrl, answer: '' });
  }, []);
  useEffect(() => { void refreshCaptcha(); }, [refreshCaptcha]);
  useEffect(() => { if (countdown <= 0) return; const timer = window.setTimeout(() => setCountdown((n) => n - 1), 1000); return () => clearTimeout(timer); }, [countdown]);
  useEffect(() => {
    const role = new URLSearchParams(window.location.search).get('role');
    if (role === 'admin') setForm((old) => ({ ...old, accountType: 'LAB_ADMIN', mode: 'CREATE', academicIdentity: 'TEACHER' }));
  }, []);

  async function sendCode() {
    setError(''); setSending(true);
    try {
      const res = await fetch('/api/auth/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.email, captchaId: captcha.id, captchaCode: captcha.answer }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || '验证码发送失败');
      setVerifyToken(body.token); setCaptchaVerified(true); setCountdown(60);
    } catch (e) { setError(e instanceof Error ? e.message : '验证码发送失败'); void refreshCaptcha(); } finally { setSending(false); }
  }

  function updateEmail(value: string) {
    set('email', value);
    if (captchaVerified) {
      setVerifyToken('');
      setCaptchaVerified(false);
      setCountdown(0);
      void refreshCaptcha();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const payload = { ...form, verifyToken, labName: form.mode === 'CREATE' ? form.labName : undefined, labLocation: form.mode === 'CREATE' ? form.labLocation : undefined, joinCode: form.mode === 'JOIN' ? form.joinCode : undefined };
      const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || Object.values(body.details || {}).flat()[0] || '申请提交失败');
      router.replace('/application-status');
    } catch (e) { setError(e instanceof Error ? e.message : '申请提交失败'); } finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#050914] px-5 py-8 text-slate-200">
    <div className="mx-auto max-w-5xl">
      <Link href="/login" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-teal-300"><ArrowLeft className="size-4" />返回登录</Link>
      <div className="grid overflow-hidden rounded-[28px] border border-white/10 bg-[#0a101a] shadow-2xl lg:grid-cols-[310px_1fr]">
        <aside className="border-b border-white/10 bg-gradient-to-b from-teal-400/[0.09] to-transparent p-8 lg:border-r lg:border-b-0">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-teal-300 text-slate-950"><FlaskConical /></span>
          <h1 className="mt-6 text-2xl font-semibold text-white">提交账号申请</h1><p className="mt-3 text-sm leading-7 text-slate-400">完成图形验证码与邮箱验证后，账号进入待审批状态，待审批通过后即可开启Lab Copilot。</p>
          <div className="mt-8 space-y-4 text-sm"><p className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-teal-300" />新实验室成立由Lab Copilot团队管理员审批</p><p className="flex gap-3"><UserRound className="size-5 shrink-0 text-sky-300" />加入实验室由 实验室总管理员 审批</p><p className="flex gap-3"><GraduationCap className="size-5 shrink-0 text-violet-300" />学院结构已预留，本期不开放公共预约</p></div>
        </aside>
        <form onSubmit={submit} className="space-y-7 p-6 sm:p-9">
          {error && <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
          <section><h2 className="mb-4 text-sm font-semibold text-white">申请账号类型</h2><div className="grid gap-3 sm:grid-cols-2">
            {([['LAB_MEMBER','实验员','申请 实验室成员'],['LAB_ADMIN','实验室管理员','新实验室通过后为 申请者为实验室总管理员；加入已有实验室为 实验室管理员']] as const).map(([value,title,desc]) => <button key={value} type="button" onClick={() => setForm((old) => ({ ...old, accountType: value, mode: value === 'LAB_ADMIN' ? old.mode : 'JOIN', academicIdentity: value === 'LAB_ADMIN' ? 'TEACHER' : old.academicIdentity }))} className={`rounded-2xl border p-4 text-left transition ${form.accountType === value ? 'border-teal-300/50 bg-teal-300/[0.08]' : 'border-white/10 bg-white/[0.02]'}`}><p className="font-medium text-white">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{desc}</p></button>)}
          </div></section>
          <section className="grid gap-4 sm:grid-cols-3"><Field label="姓名"><input required className={inputClass} value={form.name} onChange={(e)=>set('name',e.target.value)} /></Field><Field label="邮箱"><input required type="email" className={inputClass} value={form.email} onChange={(e)=>updateEmail(e.target.value)} /></Field><Field label="手机号"><input required className={inputClass} value={form.phone} onChange={(e)=>set('phone',e.target.value)} /></Field><div className="sm:col-span-3"><Field label="密码（至少 12 位）"><input required minLength={12} type="password" autoComplete="new-password" className={inputClass} value={form.password} onChange={(e)=>set('password',e.target.value)} /></Field></div></section>
          <section><h2 className="mb-4 text-sm font-semibold text-white">机构与身份</h2><div className="mb-4 flex gap-2">{([['UNIVERSITY','高校'],['ENTERPRISE','企业']] as const).map(([v,l])=><button key={v} type="button" onClick={()=>set('institutionType',v)} className={`rounded-lg px-4 py-2 text-sm ${form.institutionType===v?'bg-sky-300 text-slate-950':'bg-white/5 text-slate-400'}`}>{l}</button>)}</div>{form.institutionType==='UNIVERSITY'?<div className="grid gap-4 sm:grid-cols-3"><Field label="学校"><input required className={inputClass} value={form.schoolName} onChange={(e)=>set('schoolName',e.target.value)} /></Field><Field label="学院"><input required className={inputClass} value={form.collegeName} onChange={(e)=>set('collegeName',e.target.value)} /></Field><Field label="身份"><select className={`${inputClass} text-slate-900 bg-white`} value={form.academicIdentity} onChange={(e)=>set('academicIdentity',e.target.value as FormState['academicIdentity'])}><option value="TEACHER">老师</option><option value="STUDENT">学生</option></select></Field></div>:<div className="grid gap-4 sm:grid-cols-2"><Field label="企业名称"><input required className={inputClass} value={form.companyName} onChange={(e)=>set('companyName',e.target.value)} /></Field><Field label="企业身份"><input required className={inputClass} placeholder="请手动填写" value={form.companyIdentity} onChange={(e)=>set('companyIdentity',e.target.value)} /></Field></div>}</section>
          <section><h2 className="mb-4 text-sm font-semibold text-white">实验室申请</h2>{form.accountType==='LAB_ADMIN'&&<div className="mb-4 flex gap-2"><button type="button" onClick={()=>set('mode','CREATE')} className={`rounded-lg px-4 py-2 text-sm ${form.mode==='CREATE'?'bg-teal-300 text-slate-950':'bg-white/5 text-slate-400'}`}>创建新实验室</button><button type="button" onClick={()=>set('mode','JOIN')} className={`rounded-lg px-4 py-2 text-sm ${form.mode==='JOIN'?'bg-teal-300 text-slate-950':'bg-white/5 text-slate-400'}`}>加入已有实验室</button></div>}{form.mode==='CREATE'?<div className="grid gap-4 sm:grid-cols-2"><Field label="实验室名称"><input required className={inputClass} value={form.labName} onChange={(e)=>set('labName',e.target.value)} /></Field><Field label="实验室位置"><input required className={inputClass} value={form.labLocation} onChange={(e)=>set('labLocation',e.target.value)} /></Field></div>:<Field label="实验室加入码"><input required maxLength={6} className={`${inputClass} uppercase tracking-widest`} value={form.joinCode} onChange={(e)=>set('joinCode',e.target.value.toUpperCase())} /></Field>}<div className="mt-4"><Field label="申请说明（可选）"><textarea className={`${inputClass} h-24 py-3`} value={form.message} onChange={(e)=>set('message',e.target.value)} /></Field></div></section>
          <section className="grid gap-4 lg:grid-cols-2"><Field label="图形验证码"><div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2"><input required={!captchaVerified} disabled={captchaVerified} maxLength={4} aria-describedby="captcha-help" className={`${inputClass} min-w-0 uppercase disabled:border-emerald-400/30 disabled:text-emerald-300`} value={captchaVerified?'已验证':captcha.answer} onChange={(e)=>setCaptcha((old)=>({...old,answer:e.target.value.toUpperCase()}))}/><button type="button" disabled={captchaVerified} onClick={()=>void refreshCaptcha()} aria-label="刷新图形验证码" className="h-11 w-32 shrink-0 overflow-hidden rounded-xl bg-white disabled:cursor-default disabled:opacity-60">{captcha.url&&<>{/* eslint-disable @next/next/no-img-element */}<img src={captcha.url} alt="图形验证码" className="h-full w-full object-contain" />{/* eslint-enable @next/next/no-img-element */}</>}</button></div><span id="captcha-help" className={`mt-1.5 block text-[11px] ${captchaVerified?'text-emerald-300':'text-slate-600'}`}>{captchaVerified?'图形验证码已通过，提交申请时无需再次输入。':'获取邮箱验证码时将校验一次。'}</span></Field><Field label="邮箱验证码"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"><input required maxLength={6} inputMode="numeric" className={`${inputClass} min-w-0`} value={form.code} onChange={(e)=>set('code',e.target.value)}/><button type="button" disabled={sending||countdown>0} onClick={()=>void sendCode()} className="h-11 shrink-0 rounded-xl border border-teal-300/30 px-3 text-xs text-teal-200 disabled:opacity-50">{sending?'发送中':countdown>0?`${countdown}s`:'获取验证码'}</button></div><span aria-hidden="true" className="mt-1.5 block text-[11px] text-transparent">占位对齐</span></Field></section>
          <button disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-300 font-semibold text-slate-950 transition hover:bg-teal-200 disabled:opacity-60">{busy?<Loader2 className="size-4 animate-spin"/>:<ArrowRight className="size-4"/>}提交审批申请</button>
        </form>
      </div>
    </div>
  </main>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-2 block text-xs font-medium text-slate-400">{label}</span>{children}</label>; }
