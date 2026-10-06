'use client';

/* eslint-disable react-hooks/refs -- Robot laser coordinates read element refs only inside the post-submit error event. */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { AuthorCredit } from '@/components/author-credit';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod/v4';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  Bot,
  Eye,
  EyeOff,
  FlaskConical,
  Loader2,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  UserCircle,
  X,
  Zap,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/store/auth-store';
import type { UserRole } from '@/types';

const loginSchema = z.object({
  email: z.email('请输入有效的邮箱地址'),
  password: z.string().min(1, '请输入密码'),
});

const registrationSchema = z
  .object({
    role: z.enum(['ADMIN', 'MEMBER']),
    name: z.string().min(1, '请输入姓名').max(50, '姓名不能超过 50 个字符'),
    email: z.email('请输入有效的邮箱地址'),
    password: z.string().min(6, '密码至少需要 6 位'),
    code: z.string().length(6, '邮箱验证码为 6 位数字'),
    verifyToken: z.string().min(1, '请先获取邮箱验证码'),
    labName: z.string().optional(),
    labLocation: z.string().optional(),
    labSchool: z.string().optional(),
    labCollege: z.string().optional(),
    joinCode: z.string().optional(),
    message: z.string().max(500, '申请留言不能超过 500 个字符').optional(),
  })
  .refine(
    (data) => data.role !== 'ADMIN' || Boolean(data.labName?.trim() || data.joinCode?.trim()),
    {
      message: '请填写实验室名称，或使用加入码加入已有实验室',
      path: ['labName'],
    }
  );

type LoginForm = z.infer<typeof loginSchema>;
type RegistrationForm = z.infer<typeof registrationSchema>;
type LoginRole = 'admin' | 'user';
type RegisterRole = 'member' | 'admin';
type Gaze = { x: number; y: number };
type LaserCoordinates = {
  left: { x: number; y: number };
  right: { x: number; y: number };
  target: { x: number; y: number };
};

const ADMIN_ROLES: UserRole[] = ['ADMIN'];

function MiniAgent({ gaze, className, delay }: { gaze: Gaze; className: string; delay: string }) {
  const eyeStyle = { transform: `translate(${gaze.x * 5}px, ${gaze.y * 3}px)` };

  return (
    <div
      className={`lab-bot-float pointer-events-none absolute flex flex-col items-center ${className}`}
      style={{ '--bot-delay': delay } as CSSProperties}
      aria-hidden="true"
    >
      <div className="size-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,.95)]" />
      <div className="h-3 w-px bg-slate-400/70" />
      <div className="flex h-16 w-24 items-center justify-center rounded-[1.35rem] border border-white/45 bg-gradient-to-b from-slate-100 to-slate-400 shadow-[0_15px_35px_rgba(0,0,0,.3)]">
        <div className="flex h-8 w-[4.5rem] items-center justify-center gap-3 overflow-hidden rounded-xl border border-slate-700 bg-[#06131c] shadow-inner">
          <span className="lab-bot-eye size-2 rounded-full bg-cyan-300 shadow-[0_0_10px_#67e8f9]" style={eyeStyle} />
          <span className="lab-bot-eye size-2 rounded-full bg-cyan-300 shadow-[0_0_10px_#67e8f9]" style={eyeStyle} />
        </div>
      </div>
      <div className="h-2.5 w-4 bg-slate-500" />
      <div className="h-9 w-16 rounded-b-2xl rounded-t-lg border border-white/35 bg-gradient-to-b from-slate-200 to-slate-500 shadow-lg" />
    </div>
  );
}

function RegistrationFields({ role }: { role: RegisterRole }) {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [adminMode, setAdminMode] = useState<'create' | 'join'>('create');
  const [verifyToken, setVerifyToken] = useState('');
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeHint, setCodeHint] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaUrl, setCaptchaUrl] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const roleValue = role === 'admin' ? 'ADMIN' : 'MEMBER';

  const {
    register: registerField,
    handleSubmit: handleRegistrationSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      role: roleValue,
      name: '',
      email: '',
      password: '',
      code: '',
      verifyToken: '',
      labName: '',
      labLocation: '',
      labSchool: '',
      labCollege: '',
      joinCode: '',
      message: '',
    },
  });

  const refreshCaptcha = useCallback(async () => {
    setCaptchaLoading(true);
    try {
      const response = await fetch('/api/auth/captcha', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '图形验证码加载失败');
      if (typeof result.id !== 'string' || typeof result.imageUrl !== 'string') {
        throw new Error('图形验证码响应格式错误');
      }
      setCaptchaId(result.id);
      setCaptchaUrl(result.imageUrl);
      setCaptchaInput('');
    } catch (captchaError) {
      setCaptchaId('');
      setCaptchaUrl('');
      setError(captchaError instanceof Error ? captchaError.message : '图形验证码加载失败，请检查网络连接');
    } finally {
      setCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    setValue('role', roleValue);
    setError('');
    if (role === 'member') {
      setValue('labName', '');
      setValue('labLocation', '');
    }
  }, [role, roleValue, setValue]);

  useEffect(() => {
    void refreshCaptcha();
  }, [refreshCaptcha]);

  useEffect(() => {
    if (codeCountdown <= 0) return;
    const timer = window.setTimeout(() => setCodeCountdown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCountdown]);

  const handleSendCode = async () => {
    const email = (getValues('email') || '').trim();
    setError('');
    setCodeHint('');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请先填写有效的邮箱地址');
      return;
    }
    if (!captchaInput.trim()) {
      setError('请先输入图形验证码');
      return;
    }

    setSendingCode(true);
    try {
      const response = await fetch('/api/auth/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, captchaId, captchaCode: captchaInput.trim() }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || '验证码发送失败');
        void refreshCaptcha();
        return;
      }
      setVerifyToken(result.token);
      setValue('verifyToken', result.token);
      setCodeCountdown(60);
      setCodeHint('验证码已发送，请查收邮箱（5 分钟内有效）。');
      void refreshCaptcha();
    } catch {
      setError('网络异常，无法发送验证码');
      void refreshCaptcha();
    } finally {
      setSendingCode(false);
    }
  };

  const switchAdminMode = (mode: 'create' | 'join') => {
    setAdminMode(mode);
    setError('');
    if (mode === 'create') {
      setValue('joinCode', '');
      setValue('message', '');
    } else {
      setValue('labName', '');
      setValue('labLocation', '');
    }
  };

  const submitRegistration = async (data: RegistrationForm) => {
    setError('');
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, role: roleValue, verifyToken }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || '注册失败，请检查填写的信息');
        return;
      }
      login(result.user);
      if (roleValue === 'ADMIN') router.replace('/admin');
      else if (result.pendingApproval) router.replace('/user');
      else router.replace('/user');
    } catch {
      setError('网络异常，无法连接服务器');
    } finally {
      setIsLoading(false);
    }
  };

  const fieldClass = 'h-11 border-white/10 bg-white/[0.045] text-white shadow-none placeholder:text-slate-600 hover:border-white/20 focus:border-teal-400 focus:ring-teal-400/15';

  return (
    <form onSubmit={handleRegistrationSubmit(submitRegistration)} className="mt-6 space-y-5" noValidate>
      {error && (
        <Alert variant="destructive" className="border-rose-500/25 bg-rose-500/10 text-rose-200" role="alert">
          <AlertDescription aria-live="polite">{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="register-name" className="text-sm text-slate-300">姓名</Label>
          <Input id="register-name" autoComplete="name" placeholder="请输入真实姓名" className={fieldClass} {...registerField('name')} />
          {errors.name && <p className="text-xs text-rose-300">{errors.name.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="register-email" className="text-sm text-slate-300">邮箱</Label>
          <Input id="register-email" type="email" autoComplete="email" placeholder="name@lab.edu.cn" className={fieldClass} {...registerField('email')} />
          {errors.email && <p className="text-xs text-rose-300">{errors.email.message}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="register-password" className="text-sm text-slate-300">密码</Label>
        <Input id="register-password" type="password" autoComplete="new-password" placeholder="至少 6 位字符" className={fieldClass} {...registerField('password')} />
        {errors.password && <p className="text-xs text-rose-300">{errors.password.message}</p>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="register-captcha" className="text-sm text-slate-300">图形验证码</Label>
          <div className="flex gap-2">
            <Input id="register-captcha" value={captchaInput} onChange={(event) => setCaptchaInput(event.target.value.toUpperCase())} placeholder="图中字符" maxLength={4} className={`${fieldClass} min-w-0 flex-0.6 uppercase tracking-widest`} />
            <button type="button" onClick={() => void refreshCaptcha()} disabled={captchaLoading} aria-label="刷新图形验证码" className="h-11 shrink-0 overflow-hidden rounded-xl border border-white/15 bg-white transition-colors hover:border-teal-300/60 disabled:opacity-60">
              {captchaUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={captchaUrl}
                  alt="图形验证码"
                  className="block h-full w-auto"
                  onError={() => {
                    setCaptchaId('');
                    setCaptchaUrl('');
                    setError('验证码图片加载失败，请点击图片区域刷新');
                  }}
                />
              ) : (
                <span style={{ color: '#64748b', fontSize: 12 }}>点击刷新</span>
              )}
            </button>
          </div>
          <p className="text-[11px] leading-5 text-slate-600">看不清可点击图片刷新。</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="register-code" className="text-sm text-slate-300">邮箱验证码</Label>
          <div className="flex gap-2">
            <Input id="register-code" inputMode="numeric" placeholder="6 位验证码" maxLength={6} className={`${fieldClass} min-w-0 flex-1 tracking-widest`} {...registerField('code')} />
            <button type="button" onClick={() => void handleSendCode()} disabled={sendingCode || codeCountdown > 0} className="h-11 shrink-0 rounded-xl border border-teal-300/20 bg-teal-400/[0.07] px-3 text-xs font-semibold text-teal-200 transition-colors hover:bg-teal-400/15 disabled:cursor-not-allowed disabled:opacity-50">
              {sendingCode ? '发送中…' : codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
            </button>
          </div>
          {errors.code && <p className="text-xs text-rose-300">{errors.code.message}</p>}
          {errors.verifyToken && <p className="text-xs text-rose-300">{errors.verifyToken.message}</p>}
          {codeHint && <p className="text-[11px] leading-5 text-teal-300/70">{codeHint}</p>}
        </div>
      </div>

      {role === 'admin' && (
        <div className="space-y-4 rounded-2xl border border-sky-300/10 bg-sky-400/[0.035] p-4">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="管理员注册方式">
            <button type="button" onClick={() => switchAdminMode('create')} aria-pressed={adminMode === 'create'} className={`h-10 rounded-xl border text-xs font-semibold transition-colors ${adminMode === 'create' ? 'border-sky-300/45 bg-sky-400/12 text-sky-200' : 'border-white/10 text-slate-500 hover:border-white/20'}`}>创建新实验室</button>
            <button type="button" onClick={() => switchAdminMode('join')} aria-pressed={adminMode === 'join'} className={`h-10 rounded-xl border text-xs font-semibold transition-colors ${adminMode === 'join' ? 'border-sky-300/45 bg-sky-400/12 text-sky-200' : 'border-white/10 text-slate-500 hover:border-white/20'}`}>加入已有实验室</button>
          </div>
          {adminMode === 'create' ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="register-lab-name" className="text-sm text-slate-300">实验室名称</Label><Input id="register-lab-name" placeholder="如：有机合成实验室" className={fieldClass} {...registerField('labName')} />{errors.labName && <p className="text-xs text-rose-300">{errors.labName.message}</p>}</div>
                <div className="space-y-2"><Label htmlFor="register-lab-location" className="text-sm text-slate-300">实验室位置</Label><Input id="register-lab-location" placeholder="如：化学楼 301" className={fieldClass} {...registerField('labLocation')} /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="register-lab-school" className="text-sm text-slate-300">学校</Label><Input id="register-lab-school" placeholder="如：XX大学" className={fieldClass} {...registerField('labSchool')} /></div>
                <div className="space-y-2"><Label htmlFor="register-lab-college" className="text-sm text-slate-300">学院</Label><Input id="register-lab-college" placeholder="如：化学学院" className={fieldClass} {...registerField('labCollege')} /></div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="register-admin-join-code" className="text-sm text-slate-300">实验室加入码</Label><Input id="register-admin-join-code" placeholder="6 位字母数字" maxLength={6} className={`${fieldClass} uppercase tracking-widest`} {...registerField('joinCode')} /></div>
              <div className="space-y-2"><Label htmlFor="register-admin-message" className="text-sm text-slate-300">申请留言（可选）</Label><Input id="register-admin-message" placeholder="简述您的职责" className={fieldClass} {...registerField('message')} /></div>
            </div>
          )}
        </div>
      )}

      {role === 'member' && (
        <div className="grid gap-4 rounded-2xl border border-emerald-300/10 bg-emerald-400/[0.035] p-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="register-member-join-code" className="text-sm text-slate-300">实验室加入码（可选）</Label><Input id="register-member-join-code" placeholder="向管理员索取" maxLength={6} className={`${fieldClass} uppercase tracking-widest`} {...registerField('joinCode')} /><p className="text-[11px] leading-5 text-slate-600">填写后将自动提交入组申请。</p></div>
          <div className="space-y-2"><Label htmlFor="register-member-message" className="text-sm text-slate-300">申请留言（可选）</Label><Input id="register-member-message" placeholder="简述您的身份或课题" className={fieldClass} {...registerField('message')} /></div>
        </div>
      )}

      <Button type="submit" disabled={isLoading} className="h-12 w-full border-teal-300 bg-teal-300 text-slate-950 hover:border-teal-200 hover:bg-teal-200">
        {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        {isLoading ? '正在创建账号…' : `注册${role === 'admin' ? '管理员' : '实验员'}账号`}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((state) => state.login);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const currentUser = useAuthStore((state) => state.user);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginRole, setLoginRole] = useState<LoginRole | null>(null);
  const [demoLoading, setDemoLoading] = useState<LoginRole | null>(null);
  const [gaze, setGaze] = useState<Gaze>({ x: 0, y: 0 });
  const [isLaserFiring, setIsLaserFiring] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [laserCoordinates, setLaserCoordinates] = useState<LaserCoordinates | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerRole, setRegisterRole] = useState<RegisterRole>('member');
  const leftEyeRef = useRef<HTMLSpanElement>(null);
  const rightEyeRef = useRef<HTMLSpanElement>(null);
  const passwordTargetRef = useRef<HTMLDivElement>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const laserFrameRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const closeDialogRef = useRef<HTMLButtonElement>(null);
  const createAccountRef = useRef<HTMLButtonElement>(null);

  const redirectByRole = useCallback(
    (role: UserRole, platformRole?: string) => {
      router.replace(platformRole === 'PLATFORM_ADMIN' ? '/platform' : ADMIN_ROLES.includes(role) ? '/admin' : '/user');
    },
    [router]
  );

  useEffect(() => {
    if (isAuthenticated && currentUser) {
      if (currentUser.status && currentUser.status !== 'ACTIVE') router.replace('/application-status');
      else redirectByRole(currentUser.role, currentUser.platformRole);
    }
  }, [currentUser, isAuthenticated, redirectByRole, router]);

  useEffect(() => {
    return () => {
      if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
      if (laserFrameRef.current !== null) cancelAnimationFrame(laserFrameRef.current);
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!registerOpen) return;

    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRegisterOpen(false);
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    requestAnimationFrame(() => closeDialogRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      requestAnimationFrame(() => createAccountRef.current?.focus());
    };
  }, [registerOpen]);

  const {
    register: registerLoginField,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const updateLaserCoordinates = useCallback(() => {
    const leftEye = leftEyeRef.current?.getBoundingClientRect();
    const rightEye = rightEyeRef.current?.getBoundingClientRect();
    const target = passwordTargetRef.current?.getBoundingClientRect();
    if (!leftEye || !rightEye || !target) return;

    setLaserCoordinates({
      left: { x: leftEye.left + leftEye.width / 2, y: leftEye.top + leftEye.height / 2 },
      right: { x: rightEye.left + rightEye.width / 2, y: rightEye.top + rightEye.height / 2 },
      target: { x: target.left + 18, y: target.top + target.height / 2 },
    });
  }, []);

  const triggerErrorSequence = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    setIsLaserFiring(true);
    laserFrameRef.current = requestAnimationFrame(updateLaserCoordinates);

    // 短暂提示后恢复输入，错误文字继续保留。
    timersRef.current.push(
      window.setTimeout(() => {
        setIsLaserFiring(false);
        setLaserCoordinates(null);
      }, 500)
    );
  }, [updateLaserCoordinates]);

  const dismissLaser = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
    setIsLaserFiring(false);
    setLaserCoordinates(null);
  }, []);

  const authenticate = async (credentials: LoginForm, selectedRole: LoginRole) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    const result = await response.json();
    if (response.status === 202) {
      router.replace('/application-status');
      return;
    }
    if (!response.ok) throw new Error(result.error || '登录失败，请检查邮箱和密码');
    const accountIsAdmin = ADMIN_ROLES.includes(result.user.role) || result.user.platformRole === 'PLATFORM_ADMIN';
    const selectedIsAdmin = selectedRole === 'admin';
    if (accountIsAdmin !== selectedIsAdmin) {
      await fetch('/api/auth/logout', { method: 'POST' });
      throw new Error(`该账号不是${selectedIsAdmin ? '管理员' : '实验员'}身份，请重新选择`);
    }
    login(result.user);
    redirectByRole(result.user.role, result.user.platformRole);
  };

  const onSubmit = async (data: LoginForm) => {
    setError('');
    if (!loginRole) {
      setError('请先选择管理员或实验员身份');
      return;
    }
    setIsLoading(true);
    try {
      await authenticate(data, loginRole);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '网络异常，请稍后重试');
      triggerErrorSequence();
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async (role: LoginRole) => {
    setError('');
    setLoginRole(role);
    setDemoLoading(role);
    try {
      await authenticate(
        {
          email: role === 'admin' ? 'admin@lab.edu.cn' : 'member@lab.edu.cn',
          password: '123456',
        },
        role
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '测试账号暂时不可用');
      triggerErrorSequence();
    } finally {
      setDemoLoading(null);
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    const x = (event.clientX / window.innerWidth) * 2 - 1;
    const y = (event.clientY / window.innerHeight) * 2 - 1;
    if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
    pointerFrameRef.current = requestAnimationFrame(() => {
      setGaze({ x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) });
    });
  };

  const busy = isLoading || demoLoading !== null || isLaserFiring;
  const coreEyeStyle = isLaserFiring
    ? { transform: 'scale(1.35)' }
    : { transform: `translate(${gaze.x * 13}px, ${gaze.y * 9}px)` };

  return (
    <main
      className="relative min-h-dvh overflow-hidden bg-[#050d12] text-slate-100"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setGaze({ x: 0, y: 0 })}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className={`absolute left-[12%] top-[18%] size-[30rem] rounded-full blur-[130px] transition-colors duration-500 ${isLaserFiring ? 'bg-rose-500/10' : 'bg-teal-500/12'}`} />
        <div className="absolute -bottom-52 right-0 size-[34rem] rounded-full bg-sky-500/10 blur-[150px]" />
        <div className="absolute inset-0 opacity-[0.045] [background-image:linear-gradient(rgba(255,255,255,.55)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.55)_1px,transparent_1px)] [background-size:42px_42px]" />
      </div>

      {isLaserFiring && laserCoordinates && (
        <>
        <svg className="pointer-events-none fixed inset-0 z-[70] h-full w-full" aria-hidden="true">
          <defs>
            <filter id="laser-glow">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          {[laserCoordinates.left, laserCoordinates.right].map((eye, index) => (
            <g key={index} filter="url(#laser-glow)">
              <line x1={eye.x} y1={eye.y} x2={laserCoordinates.target.x} y2={laserCoordinates.target.y} stroke="#fb7185" strokeWidth="5" strokeOpacity=".24" />
              <line x1={eye.x} y1={eye.y} x2={laserCoordinates.target.x} y2={laserCoordinates.target.y} stroke="#fff1f2" strokeWidth="1.5" />
            </g>
          ))}
          <circle className="lab-laser-impact" cx={laserCoordinates.target.x} cy={laserCoordinates.target.y} r="8" fill="#fff1f2" filter="url(#laser-glow)" />
        </svg>
        <button type="button" onClick={dismissLaser} className="fixed bottom-24 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-rose-400/40 bg-rose-950/80 px-5 py-2.5 text-sm font-semibold text-rose-200 backdrop-blur-md transition-colors hover:bg-rose-900/80">
          <Zap className="size-4" />关闭警报
        </button>
        </>
      )}

      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1600px] lg:grid-cols-[minmax(0,1fr)_520px] xl:grid-cols-[minmax(0,1fr)_580px]">
        <section className="relative hidden min-h-dvh overflow-hidden lg:flex lg:flex-col">
          <Link href="/login" className="absolute left-10 top-9 z-20 flex items-center gap-3 xl:left-14" aria-label="Lab Copilot 登录页">
            <span className="flex size-11 items-center justify-center rounded-2xl border border-teal-300/25 bg-teal-400/15 shadow-lg shadow-teal-950/30 backdrop-blur-md">
              <FlaskConical className="size-5 text-teal-300" />
            </span>
            <span>
              <span className="block text-base font-bold tracking-wide text-white">Lab Copilot</span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.22em] text-teal-300/70">Safety intelligence</span>
            </span>
          </Link>

          <div className="relative flex flex-1 items-center justify-center pb-24 pt-28">
            <div className="lab-bot-orbit absolute size-[31rem] rounded-full border border-teal-300/10" aria-hidden="true" />
            <div className="lab-bot-orbit-reverse absolute size-[23rem] rounded-full border border-dashed border-cyan-300/10" aria-hidden="true" />
            <div className="absolute size-[18rem] rounded-full bg-teal-400/[0.07] blur-3xl" aria-hidden="true" />

            <MiniAgent gaze={gaze} delay="-0.8s" className="left-[10%] top-[25%] scale-[.72] opacity-70 xl:left-[15%]" />
            <MiniAgent gaze={gaze} delay="-2.6s" className="bottom-[21%] left-[18%] scale-[.48] opacity-45" />
            <MiniAgent gaze={gaze} delay="-1.7s" className="right-[12%] top-[22%] scale-[.58] opacity-55 xl:right-[17%]" />

            <div className={`lab-bot-float relative z-10 flex flex-col items-center ${isLaserFiring ? '[animation-play-state:paused]' : ''}`} style={{ '--bot-delay': '0s' } as CSSProperties}>
              <div className={`size-4 rounded-full transition-all ${isLaserFiring ? 'bg-rose-400 shadow-[0_0_24px_#fb7185]' : 'bg-teal-300 shadow-[0_0_20px_#5eead4]'}`} />
              <div className="h-6 w-1.5 bg-gradient-to-b from-slate-300 to-slate-600" />
              <div className={`relative flex h-36 w-52 items-center justify-center overflow-hidden rounded-[2.5rem] border bg-gradient-to-b from-slate-100 via-slate-300 to-slate-500 shadow-[0_28px_70px_rgba(0,0,0,.45)] transition-all ${isLaserFiring ? 'border-rose-300/80 shadow-[0_0_60px_rgba(244,63,94,.22)]' : 'border-white/60'}`}>
                <div className="absolute left-5 top-4 h-8 w-20 -rotate-6 rounded-full bg-white/40 blur-xl" />
                <div className="relative flex h-[4.6rem] w-40 items-center justify-center gap-8 overflow-hidden rounded-[1.4rem] border border-slate-700 bg-[#030c13] shadow-[inset_0_5px_22px_rgba(0,0,0,.9)]">
                  <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(rgba(255,255,255,.3)_1px,transparent_1px)] [background-size:5px_5px]" />
                  <span ref={leftEyeRef} className={`lab-bot-eye relative z-10 size-5 rounded-full ${isLaserFiring ? 'bg-rose-400 shadow-[0_0_28px_#fb7185]' : 'bg-teal-300 shadow-[0_0_22px_#5eead4]'}`} style={coreEyeStyle} />
                  <span ref={rightEyeRef} className={`lab-bot-eye relative z-10 size-5 rounded-full ${isLaserFiring ? 'bg-rose-400 shadow-[0_0_28px_#fb7185]' : 'bg-teal-300 shadow-[0_0_22px_#5eead4]'}`} style={coreEyeStyle} />
                </div>
              </div>
              <div className="h-5 w-9 border-x border-slate-400/60 bg-slate-600" />
              <div className={`relative h-[5.5rem] w-36 rounded-b-[2rem] rounded-t-2xl border bg-gradient-to-b from-slate-200 to-slate-500 shadow-2xl transition-colors ${isLaserFiring ? 'border-rose-300/70' : 'border-white/45'}`}>
                <div className="mt-4 flex justify-center gap-2">
                  <span className={`size-2 rounded-full ${isLaserFiring ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                  <span className="size-2 rounded-full bg-amber-400" />
                  <span className="size-2 rounded-full bg-cyan-400" />
                </div>
                <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-slate-600/50" />
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-600/40" />
              </div>
            </div>
          </div>

          <div className="absolute bottom-10 left-0 right-0 z-20 text-center">
            {isLaserFiring ? (
              <div role="status" aria-live="polite">
                <p className="flex items-center justify-center gap-2 text-lg font-bold tracking-[0.18em] text-rose-300"><ShieldAlert className="size-5" />ACCESS DENIED</p>
                <p className="mt-2 text-xs tracking-wider text-rose-300/65">异常凭证已拦截 · 防护光束校验中</p>
              </div>
            ) : (
              <>
                <p className="text-3xl font-semibold tracking-wide text-white">Lab <span className="font-light text-teal-300">Copilot</span></p>
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.23em] text-teal-300/55">AI laboratory safety copilot</p>
              </>
            )}
          </div>

          <div className="absolute bottom-7 left-9 flex items-center gap-2 rounded-full border border-teal-300/10 bg-slate-950/35 px-3 py-2 text-[11px] text-slate-400 backdrop-blur-md xl:left-12">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-teal-300 opacity-60" /><span className="relative size-2 rounded-full bg-teal-300" /></span>
            4 个智能节点在线 v0.1
          </div>
        </section>

        <section className="relative z-20 flex min-h-dvh items-center justify-center border-l border-white/[0.06] bg-[#071116]/90 px-5 py-7 shadow-[-20px_0_70px_rgba(0,0,0,.24)] backdrop-blur-xl sm:px-10 lg:px-12 xl:px-[4.25rem]">
          <div className="w-full max-w-[440px]">
            <div className="mb-6 flex items-center gap-3 lg:hidden">
              <span className="flex size-10 items-center justify-center rounded-xl bg-teal-500/15"><FlaskConical className="size-5 text-teal-300" /></span>
              <div><p className="font-bold text-white">Lab Copilot</p><p className="text-xs text-slate-500">机器人实验室安全协作平台</p></div>
            </div>

            <div className="rounded-[1.75rem] border border-white/10 bg-slate-950/50 p-5 shadow-2xl shadow-black/30 sm:p-8">
              <div className="mb-6">
                <div className="mb-4 flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-emerald-700 shadow-lg shadow-teal-950/40"><LockKeyhole className="size-5 text-white" /></span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-300/10 bg-teal-400/[0.07] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-teal-300/70"><Zap className="size-3" />安全链路在线</span>
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-white">欢迎回来</h1>
                <p className="mt-2 text-sm leading-6 text-slate-400">输入组织凭证。</p>
              </div>

              {error && <Alert variant="destructive" className="mb-4 border-rose-500/25 bg-rose-500/10 text-rose-200" role="alert"><AlertDescription aria-live="polite">{error}</AlertDescription></Alert>}

              <fieldset className="mb-4">
                <legend className="mb-2 text-xs font-semibold text-slate-400">选择登录身份</legend>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" disabled={busy} onClick={() => { setLoginRole('user'); setError(''); }} aria-pressed={loginRole === 'user'} className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all disabled:opacity-50 ${loginRole === 'user' ? 'border-emerald-300/55 bg-emerald-400/15 text-emerald-200 shadow-[0_0_0_3px_rgba(110,231,183,.06)]' : 'border-white/10 bg-white/[0.04] text-slate-400 hover:border-emerald-400/35 hover:text-emerald-200'}`}><UserCircle className="size-4" />实验员</button>
                  <button type="button" disabled={busy} onClick={() => { setLoginRole('admin'); setError(''); }} aria-pressed={loginRole === 'admin'} className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all disabled:opacity-50 ${loginRole === 'admin' ? 'border-sky-300/55 bg-sky-400/15 text-sky-200 shadow-[0_0_0_3px_rgba(125,211,252,.06)]' : 'border-white/10 bg-white/[0.04] text-slate-400 hover:border-sky-400/35 hover:text-sky-200'}`}><ShieldCheck className="size-4" />管理员</button>
                </div>
              </fieldset>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-slate-300">邮箱</Label>
                  <Input id="email" type="email" autoComplete="email" placeholder="name@lab.edu.cn" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} className="h-12 border-white/10 bg-white/[0.055] text-white shadow-none placeholder:text-slate-600 hover:border-white/20 focus:border-teal-400 focus:ring-teal-400/15" {...registerLoginField('email')} />
                  {errors.email && <p id="email-error" className="text-xs text-rose-300">{errors.email.message}</p>}
                </div>

                <div ref={passwordTargetRef} className={`space-y-2 ${isShaking ? 'lab-auth-shake' : ''}`}>
                  <div className="flex items-center justify-between"><Label htmlFor="password" className={`text-sm font-medium ${isLaserFiring ? 'text-rose-300' : 'text-slate-300'}`}>密码</Label><Link href="/forgot-password" className="text-xs font-medium text-teal-300 transition-colors hover:text-teal-200">忘记密码？</Link></div>
                  <div className="relative">
                    <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="请输入密码" aria-invalid={Boolean(errors.password) || Boolean(error)} aria-describedby={errors.password ? 'password-error' : undefined} className={`h-12 bg-white/[0.055] pr-12 text-white shadow-none placeholder:text-slate-600 ${isLaserFiring ? 'border-rose-400/70 ring-2 ring-rose-400/10' : 'border-white/10 hover:border-white/20 focus:border-teal-400 focus:ring-teal-400/15'}`} {...registerLoginField('password')} />
                    <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute right-1 top-1 flex size-10 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200" aria-label={showPassword ? '隐藏密码' : '显示密码'}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
                  </div>
                  {errors.password && <p id="password-error" className="text-xs text-rose-300">{errors.password.message}</p>}
                </div>

                <Button type="submit" disabled={busy || !loginRole} className={`h-12 w-full text-slate-950 shadow-lg transition-colors ${loginRole === 'admin' ? 'border-sky-400 bg-sky-400 shadow-sky-950/30 hover:border-sky-300 hover:bg-sky-300' : loginRole === 'user' ? 'border-emerald-400 bg-emerald-400 shadow-emerald-950/30 hover:border-emerald-300 hover:bg-emerald-300' : 'border-slate-600 bg-slate-600 text-slate-300 shadow-none'}`}>
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{isLoading ? '正在验证…' : loginRole ? `以${loginRole === 'admin' ? '管理员' : '实验员'}身份登录` : '请先选择登录身份'}
                </Button>
              </form>

              <div className="my-4 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600"><span className="h-px flex-1 bg-white/10" />测试入口<span className="h-px flex-1 bg-white/10" /></div>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled={busy} onClick={() => void handleDemoLogin('user')} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] text-xs font-semibold text-emerald-200 transition-colors hover:border-emerald-300/45 hover:bg-emerald-400/15 disabled:opacity-50">{demoLoading === 'user' ? <Loader2 className="size-4 animate-spin" /> : <UserCircle className="size-4" />}实验员测试</button>
                <button type="button" disabled={busy} onClick={() => void handleDemoLogin('admin')} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-sky-400/25 bg-sky-400/[0.07] text-xs font-semibold text-sky-200 transition-colors hover:border-sky-300/45 hover:bg-sky-400/15 disabled:opacity-50">{demoLoading === 'admin' ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}管理员测试</button>
              </div>

              <p className="mt-5 text-center text-sm text-slate-500">还没有账号？<button ref={createAccountRef} type="button" onClick={() => router.push(`/register?role=${loginRole === 'admin' ? 'admin' : 'member'}`)} className="ml-1 rounded font-semibold text-teal-300 transition-colors hover:text-teal-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300">提交账号申请</button></p>
            </div>
            <p className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-600"><ShieldCheck className="size-3.5" />登录信息通过安全连接传输</p>
            <AuthorCredit dark />
          </div>
        </section>
      </div>

      {registerOpen && (
        <div className="lab-dialog-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-[#02080c]/80 p-4 backdrop-blur-md" onMouseDown={(event) => { if (event.target === event.currentTarget) setRegisterOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="register-dialog-title" aria-describedby="register-dialog-description" className="lab-dialog-panel relative my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a171c] shadow-[0_30px_100px_rgba(0,0,0,.65)]">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-teal-400/10 to-transparent" />
            <div className="relative shrink-0 border-b border-white/[0.07] px-6 py-5 sm:px-8">
              <button ref={closeDialogRef} type="button" onClick={() => setRegisterOpen(false)} className="absolute right-5 top-5 flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:bg-white/10 hover:text-white" aria-label="关闭注册窗口"><X className="size-4" /></button>
              <div className="flex items-center gap-4 pr-12">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-400/10 text-teal-300"><Bot className="size-5" /></span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-300/70">Create account</p>
                  <h2 id="register-dialog-title" className="mt-1 text-xl font-bold text-white sm:text-2xl">创建 Lab Copilot 账号</h2>
                  <p id="register-dialog-description" className="mt-1 text-xs leading-5 text-slate-400 sm:text-sm">选择身份并在此窗口完成全部注册信息。</p>
                </div>
              </div>
            </div>

            <div className="relative overflow-y-auto px-6 pb-7 pt-5 sm:px-8">
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">选择账号类型</legend>
                {([
                  { value: 'member' as const, title: '实验员账号', description: '加入实验室、预约设备并管理实验记录', icon: UserCircle },
                  { value: 'admin' as const, title: '管理员账号', description: '创建实验室或申请加入已有实验室', icon: ShieldCheck },
                ]).map((option) => {
                  const selected = registerRole === option.value;
                  const Icon = option.icon;
                  return (
                    <button key={option.value} type="button" onClick={() => setRegisterRole(option.value)} aria-pressed={selected} className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${selected ? 'border-teal-300/55 bg-teal-400/10 shadow-[0_0_0_3px_rgba(45,212,191,.06)]' : 'border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.055]'}`}>
                      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-teal-300 text-slate-950' : 'bg-white/[0.06] text-slate-400'}`}><Icon className="size-[18px]" /></span>
                      <span><span className="block text-sm font-semibold text-white">{option.title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{option.description}</span></span>
                    </button>
                  );
                })}
              </fieldset>
              <RegistrationFields role={registerRole} />
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
