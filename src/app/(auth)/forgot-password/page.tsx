'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, KeyRound, ArrowLeft, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '请求失败');
        return;
      }
      setDone(true);
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0a101a] p-8 shadow-2xl">
        <Link href="/login" className="mb-6 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-teal-400">
          <ArrowLeft className="size-3.5" /> 返回登录
        </Link>

        {done ? (
          <div className="text-center">
            <MailCheck className="mx-auto size-12 text-teal-400" />
            <h1 className="mt-4 text-xl font-semibold text-white">重置链接已发送</h1>
            <p className="mt-2 text-sm text-slate-400">
              如果该邮箱已注册，重置链接已发送至 <span className="text-teal-300">{email}</span>，请在 30 分钟内查收并完成重置。
            </p>
            <p className="mt-3 text-xs text-slate-600">未收到？请检查垃圾邮件箱，或稍后重试。</p>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-teal-700">
                <KeyRound className="size-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-white">忘记密码</h1>
                <p className="text-xs text-slate-500">输入注册邮箱，我们将发送密码重置链接</p>
              </div>
            </div>

            {error && (
              <Alert variant="destructive" className="mb-4 bg-red-950/20 border-red-900/40 text-red-400">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[11px] uppercase tracking-wider text-slate-400">注册邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@lab.edu.cn"
                  className="h-12 border-slate-800 bg-[#050914] text-slate-200 placeholder:text-slate-700 focus-visible:border-teal-500 focus-visible:ring-teal-500/50"
                />
              </div>
              <Button
                type="submit"
                disabled={isLoading}
                className="h-12 w-full bg-teal-600/90 text-white hover:bg-teal-500"
              >
                {isLoading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                发送重置链接
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
