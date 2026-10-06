'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, CheckCircle2, XCircle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

function ResetPasswordInner() {
  const params = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('缺少重置令牌，请通过邮件中的链接访问');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '重置失败');
        return;
      }
      setDone(true);
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0a101a] p-8 text-center shadow-2xl">
          <XCircle className="mx-auto size-12 text-rose-400" />
          <h1 className="mt-4 text-xl font-semibold text-white">链接无效</h1>
          <p className="mt-2 text-sm text-slate-400">缺少重置令牌，请通过邮件中的链接访问。</p>
          <Link href="/forgot-password" className="mt-6 inline-block text-sm text-teal-400 hover:text-teal-300">
            重新申请重置链接
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0a101a] p-8 shadow-2xl">
        {done ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-400" />
            <h1 className="mt-4 text-xl font-semibold text-white">密码重置成功</h1>
            <p className="mt-2 text-sm text-slate-400">您现在可以使用新密码登录。</p>
            <Link
              href="/login"
              className="mt-6 inline-block rounded-lg bg-teal-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-teal-500"
            >
              前往登录
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700">
                <ShieldCheck className="size-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white">设置新密码</h1>
                <p className="text-xs text-slate-500">请输入新密码，长度至少 6 位</p>
              </div>
            </div>

            {error && (
              <Alert variant="destructive" className="mb-4 bg-red-950/20 border-red-900/40 text-red-400">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-[11px] uppercase tracking-wider text-slate-400">新密码</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 border-slate-800 bg-[#050914] text-slate-200 placeholder:text-slate-700 focus-visible:border-teal-500 focus-visible:ring-teal-500/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm" className="text-[11px] uppercase tracking-wider text-slate-400">确认新密码</Label>
                <Input
                  id="confirm"
                  type="password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="h-12 border-slate-800 bg-[#050914] text-slate-200 placeholder:text-slate-700 focus-visible:border-teal-500 focus-visible:ring-teal-500/50"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading}
                className="h-12 w-full bg-teal-600/90 text-white hover:bg-teal-500"
              >
                {isLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                重置密码
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="size-8 animate-spin text-slate-500" />
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
