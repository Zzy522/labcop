'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('缺少验证令牌，请通过邮件中的链接访问。');
      return;
    }
    (async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (res.ok) {
          setStatus('success');
        } else {
          setStatus('error');
          setMessage(data.error || '验证失败');
        }
      } catch {
        setStatus('error');
        setMessage('网络异常，请稍后重试');
      }
    })();
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0a101a] p-8 text-center shadow-2xl">
        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto size-10 animate-spin text-teal-400" />
            <p className="mt-4 text-sm text-slate-400">正在验证邮箱...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto size-12 text-emerald-400" />
            <h1 className="mt-4 text-xl font-semibold text-white">邮箱验证成功</h1>
            <p className="mt-2 text-sm text-slate-400">您的邮箱已验证，现在可以登录使用全部功能。</p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-lg bg-teal-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-teal-500"
            >
              前往登录
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle className="mx-auto size-12 text-rose-400" />
            <h1 className="mt-4 text-xl font-semibold text-white">验证失败</h1>
            <p className="mt-2 text-sm text-slate-400">{message}</p>
            <p className="mt-3 text-xs text-slate-600">请登录后在账号设置中重新发送验证邮件。</p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-lg bg-teal-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-teal-500"
            >
              返回登录
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-8 animate-spin text-slate-500" />
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
