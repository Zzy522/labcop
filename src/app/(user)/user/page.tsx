'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, Bell, Bot, CalendarClock, CalendarRange, ClipboardCheck,
  Clock3, Cpu, FileClock, FileText, FlaskConical, FlaskRound, FolderKanban, ImagePlus,
  Loader2, ShieldCheck, Sparkles, Building2, UserPlus, CircleCheckBig, TriangleAlert,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MemberDashboard {
  pendingApplications: number;
  todayReservations: number;
  activeProjectTasks: number;
  overdueProjectTasks: number;
  unreadNotifications: number;
  inspectionTasks: number;
  ownChangeRequests: number;
  isProjectManager: boolean;
  managerProjectCount: number;
  managerPendingReviews: number;
  managerChangeReviews: number;
  managerDocumentReviews: number;
  ocrQueue: { queued: number; processing: number; failed: number; pendingItems: number };
  projectTasks: Array<{ id: string; name: string; status: string; progress: number; dueDate: string | null; project: { id: string; name: string } }>;
  timeline: Array<{ id: string; type: string; title: string; time: string; href: string; status: string }>;
}

async function fetchMemberDashboard(): Promise<MemberDashboard> {
  const response = await authFetch('/api/dashboard/member');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '个人工作台加载失败');
  return result;
}

function greeting() { const hour = new Date().getHours(); return hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好'; }

const workCards = [
  { label: '查找与领用试剂', description: '查询库存、安全信息并提交申请', href: '/user/alerts', icon: FlaskConical, tone: 'from-emerald-500 to-teal-500' },
  { label: 'OCR 票据入库', description: '上传票据、核对识别结果并入库', href: '/user/upload', icon: ImagePlus, tone: 'from-cyan-500 to-blue-500' },
  { label: '预约仪器设备', description: '查看排期、资质和可用时段', href: '/user/equipment-apply', icon: Cpu, tone: 'from-indigo-500 to-violet-500' },
  { label: '我的科研课题', description: '阶段任务、文档和课题协作', href: '/user/knowledge', icon: FolderKanban, tone: 'from-violet-500 to-purple-500' },
  { label: '化合物知识库', description: '合成批次、活性测试和科研数据', href: '/user/compounds', icon: FlaskRound, tone: 'from-fuchsia-500 to-pink-500' },
  { label: '执行安全巡检', description: '完成分配给我的巡检任务', href: '/user/inspections', icon: ClipboardCheck, tone: 'from-amber-400 to-orange-500' },
];

interface MyJoinStatus {
  status: 'NONE' | 'PENDING' | 'REJECTED' | 'APPROVED';
  lab?: { id: string; name: string };
  request?: {
    id: string;
    status: string;
    rejectReason: string | null;
    createdAt: string;
    lab: { id: string; name: string };
  };
  user?: { labId: string; labName: string };
}

async function fetchMyJoinStatus(): Promise<MyJoinStatus> {
  const response = await authFetch('/api/labs/join');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '入组状态加载失败');
  return result.data;
}

function LabJoinGate({ onApproved }: { onApproved: (user: { labId: string; labName: string }) => void }) {
  const [labIdentifier, setLabIdentifier] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const joinStatus = useQuery({
    queryKey: ['labs', 'join', 'mine'],
    queryFn: fetchMyJoinStatus,
    refetchInterval: (query) => query.state.data?.status === 'PENDING' ? 15_000 : false,
  });

  useEffect(() => {
    if (joinStatus.data?.status === 'APPROVED' && joinStatus.data.user) {
      onApproved(joinStatus.data.user);
    }
  }, [joinStatus.data, onApproved]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!labIdentifier.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await authFetch('/api/labs/join', {
        method: 'POST',
        body: JSON.stringify({ labIdentifier: labIdentifier.trim(), message: message.trim() || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '入组申请提交失败');
      await joinStatus.refetch();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '入组申请提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (joinStatus.isLoading) {
    return <div className="flex min-h-[520px] items-center justify-center"><Loader2 className="size-8 animate-spin text-emerald-600" /></div>;
  }

  if (joinStatus.data?.status === 'PENDING') {
    const lab = joinStatus.data.lab ?? joinStatus.data.request?.lab;
    return (
      <div className="flex min-h-[520px] items-center justify-center p-4">
        <Card className="w-full max-w-xl border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 shadow-xl shadow-amber-900/10">
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-amber-100 text-amber-600"><Clock3 className="size-8" /></div>
            <Badge className="mt-5 bg-amber-100 text-amber-700 hover:bg-amber-100">等待审批中</Badge>
            <h2 className="mt-3 text-2xl font-black text-slate-900">入组申请已提交</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">您申请加入{lab ? `「${lab.name}」` : '实验室'}，请等待实验室管理员审批。审批通过后本页面会自动进入工作台。</p>
            {lab && <p className="mt-4 rounded-xl bg-white/80 px-4 py-3 font-mono text-xs text-slate-500">实验室 ID：{lab.id}</p>}
            <Button variant="outline" className="mt-5" onClick={() => void joinStatus.refetch()} disabled={joinStatus.isFetching}>
              {joinStatus.isFetching ? <Loader2 className="size-4 animate-spin" /> : <CircleCheckBig className="size-4" />} 检查审批状态
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const rejected = joinStatus.data?.status === 'REJECTED';
  return (
    <div className="flex min-h-[520px] items-center justify-center p-4">
      <Card className="w-full max-w-xl border-emerald-100 bg-gradient-to-br from-white via-emerald-50/60 to-cyan-50/60 shadow-xl shadow-emerald-900/10">
        <CardContent className="p-7 sm:p-9">
          <div className="flex items-start gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white"><Building2 className="size-7" /></div>
            <div><h2 className="text-xl font-black text-slate-900">加入实验室后开始工作</h2><p className="mt-1 text-sm leading-6 text-slate-500">请输入管理员提供的实验室 ID 或 6 位加入码，提交后等待管理员审批。</p></div>
          </div>
          {rejected && (
            <div className="mt-5 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>上次申请未通过{joinStatus.data?.request?.rejectReason ? `：${joinStatus.data.request.rejectReason}` : '，请确认信息后重新提交'}。</span>
            </div>
          )}
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div><label className="mb-1.5 block text-sm font-medium text-slate-700">实验室 ID / 加入码</label><input value={labIdentifier} onChange={(event) => setLabIdentifier(event.target.value)} placeholder="粘贴实验室 ID 或输入 6 位加入码" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></div>
            <div><label className="mb-1.5 block text-sm font-medium text-slate-700">申请留言（可选）</label><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="简述姓名、课题或职责" maxLength={500} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></div>
            {(submitError || joinStatus.error) && <p className="text-sm text-rose-600">{submitError || (joinStatus.error instanceof Error ? joinStatus.error.message : '状态加载失败')}</p>}
            <Button type="submit" className="h-11 w-full bg-gradient-to-r from-emerald-600 to-teal-600" disabled={!labIdentifier.trim() || submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />} 提交入组申请
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function UserDashboardPage() {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [hello, setHello] = useState(greeting());
  const [activeWork, setActiveWork] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setHello(greeting()), 60000); return () => window.clearInterval(timer); }, []);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'member', user?.id, user?.labId],
    queryFn: fetchMemberDashboard,
    enabled: Boolean(user?.labId),
  });

  if (!user?.labId) return <LabJoinGate onApproved={updateUser} />;

  if (isLoading) return <div className="flex min-h-[520px] items-center justify-center"><Loader2 className="size-8 animate-spin text-emerald-600" /></div>;
  if (!data || error) return <div className="flex min-h-[420px] flex-col items-center justify-center gap-3"><p className="text-sm text-rose-600">{error instanceof Error ? error.message : '个人工作台加载失败'}</p><Button variant="outline" onClick={() => void refetch()}>重新加载</Button></div>;

  const activeCard = workCards[activeWork];
  const overdue = data.overdueProjectTasks > 0;
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border border-white/80 bg-white/68 p-5 shadow-xl shadow-emerald-900/5 backdrop-blur-2xl sm:p-6"><div className="absolute -right-16 -top-24 size-72 rounded-full bg-emerald-300/20 blur-3xl" /><div className="relative flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600"><Sparkles className="size-4" />My laboratory workspace</div><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">{hello}，{user?.name || '实验员'}</h2><p className="mt-1 text-sm text-slate-500">今日工作、科研任务和安全事项已汇总到个人工作台</p></div><div className="flex gap-2"><Link href="/user/notifications"><Button variant="outline" className="relative bg-white/70"><Bell className="size-4" />我的通知{data.unreadNotifications > 0 && <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-orange-500 text-[10px] text-white">{data.unreadNotifications}</span>}</Button></Link><Link href="/user/assistant"><Button className="bg-gradient-to-r from-emerald-600 to-teal-600"><Bot className="size-4" />打开 AI 助手</Button></Link></div></div></section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><MemberMetric icon={FileText} label="我的申请" value={data.pendingApplications} hint={data.pendingApplications ? '等待管理员处理' : '暂无待处理申请'} tone="blue" /><MemberMetric icon={CalendarClock} label="今日预约" value={data.todayReservations} hint="今日已通过/进行中的设备预约" tone="cyan" /><MemberMetric icon={CalendarRange} label="课题任务" value={data.activeProjectTasks} hint={overdue ? `${data.overdueProjectTasks} 项已逾期` : '当前没有逾期任务'} tone={overdue ? 'rose' : 'violet'} /><MemberMetric icon={Bell} label="未读通知" value={data.unreadNotifications} hint="申请结果、通告与安全提醒" tone="amber" /></div>

      {(data.ocrQueue.queued + data.ocrQueue.processing + data.ocrQueue.pendingItems + data.ocrQueue.failed > 0) && (
        <Card className="border-cyan-200 bg-gradient-to-r from-cyan-50 via-white to-sky-50 shadow-sm">
          <CardContent className="flex flex-wrap items-center gap-4 p-4">
            <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white"><ImagePlus className="size-5" /></div>
            <div className="min-w-0 flex-1"><p className="font-bold text-slate-900">OCR 智能票据入库</p><p className="mt-1 text-xs text-slate-500">排队 {data.ocrQueue.queued} · 识别中 {data.ocrQueue.processing} · 待逐条确认 {data.ocrQueue.pendingItems}{data.ocrQueue.failed ? ` · 失败 ${data.ocrQueue.failed}` : ''}</p></div>
            {data.ocrQueue.pendingItems > 0 ? <Link href="/user/upload?mode=photo&review=1"><Button className="bg-cyan-600 hover:bg-cyan-700">逐条确认入库<ArrowRight className="size-4" /></Button></Link> : <Link href="/user/upload?mode=photo"><Button variant="outline">查看识别队列</Button></Link>}
          </CardContent>
        </Card>
      )}

      {data.isProjectManager && <Card className="border-violet-200 bg-gradient-to-r from-violet-50/90 via-white to-indigo-50/70 shadow-sm"><CardContent className="flex flex-wrap items-center gap-4 p-4"><div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white"><ShieldCheck className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="font-bold text-slate-900">课题管理员工作区</p><Badge variant="outline" className="border-violet-200 text-violet-700">管理 {data.managerProjectCount} 个课题</Badge></div><p className="mt-1 text-xs text-slate-500">阶段任务修改 {data.managerChangeReviews} 项 · 课题文档 {data.managerDocumentReviews} 项待审批</p></div><Link href="/user/knowledge"><Button className="bg-violet-600 hover:bg-violet-700">处理科研审批<ArrowRight className="size-4" /></Button></Link></CardContent></Card>}

      <div className="grid gap-4 xl:grid-cols-12"><Card className="border-white/80 bg-white/68 shadow-lg shadow-slate-900/5 backdrop-blur-2xl xl:col-span-3"><CardHeader><CardTitle className="text-base">我的待办</CardTitle></CardHeader><CardContent className="space-y-2"><TodoLink href="/user/applications" icon={FileClock} label="待处理申请" count={data.pendingApplications} /><TodoLink href="/user/equipment-apply" icon={Cpu} label="今日设备预约" count={data.todayReservations} /><TodoLink href="/user/inspections" icon={ClipboardCheck} label="巡检任务" count={data.inspectionTasks} /><TodoLink href="/user/knowledge" icon={CalendarRange} label="阶段任务" count={data.activeProjectTasks} danger={overdue} /><TodoLink href="/user/knowledge" icon={FileText} label="我的修改申请" count={data.ownChangeRequests} />{data.isProjectManager && <TodoLink href="/user/knowledge" icon={ShieldCheck} label="科研审批" count={data.managerPendingReviews} />}</CardContent></Card>

        <Card className="relative overflow-hidden border-white/80 bg-gradient-to-br from-white/85 via-emerald-50/60 to-cyan-50/55 shadow-xl shadow-emerald-900/5 backdrop-blur-2xl xl:col-span-6"><div className="absolute left-1/2 top-20 size-64 -translate-x-1/2 rounded-full bg-emerald-300/20 blur-3xl" /><CardHeader className="relative"><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2"><Sparkles className="size-5 text-emerald-600" />实验工作卡组</CardTitle><span className="text-xs text-slate-400">选择入口查看说明</span></div></CardHeader><CardContent className="relative"><div className="grid gap-2 sm:grid-cols-3">{workCards.map((card, index) => <button key={card.href} type="button" onClick={() => setActiveWork(index)} className={cn('rounded-2xl border p-3 text-left transition', activeWork === index ? 'border-emerald-200 bg-white shadow-lg shadow-emerald-900/10' : 'border-white/70 bg-white/45 hover:bg-white')}><div className={cn('flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white', card.tone)}><card.icon className="size-4" /></div><p className="mt-2 text-sm font-semibold text-slate-800">{card.label}</p></button>)}</div><div className="mx-auto mt-5 max-w-xl rounded-[28px] border border-white/90 bg-white/76 p-6 shadow-2xl shadow-emerald-900/10 backdrop-blur-xl"><div className="flex items-start justify-between"><div className={cn('flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg', activeCard.tone)}><activeCard.icon className="size-6" /></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">常用操作</span></div><h3 className="mt-4 text-xl font-black text-slate-900">{activeCard.label}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{activeCard.description}</p><Link href={activeCard.href}><Button className="mt-5 w-full bg-gradient-to-r from-emerald-600 to-teal-600">立即进入<ArrowRight className="size-4" /></Button></Link></div></CardContent></Card>

        <div className="space-y-4 xl:col-span-3"><Card className="border-emerald-100 bg-gradient-to-br from-emerald-700 to-teal-800 text-white shadow-xl shadow-emerald-900/15"><CardHeader><CardTitle className="flex items-center gap-2 text-base text-white"><Bot className="size-5 text-emerald-200" />智能实验助理</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-6 text-emerald-100"><p>你有 {data.activeProjectTasks} 项进行中的科研任务和 {data.inspectionTasks} 项巡检事项。</p>{overdue ? <p className="rounded-xl bg-white/10 p-3">有 {data.overdueProjectTasks} 项课题任务已逾期，建议先查看任务阻塞原因。</p> : <p className="rounded-xl bg-white/10 p-3">当前课题任务没有逾期记录。</p>}<p>可上传试剂标签、实验照片或谱图，让视觉模型辅助理解。</p><Link href="/user/assistant"><Button variant="outline" className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20">开始对话</Button></Link></CardContent></Card><Card className="border-white/80 bg-white/72"><CardHeader><CardTitle className="text-base">我的课题任务</CardTitle></CardHeader><CardContent className="space-y-2">{data.projectTasks.length === 0 ? <p className="py-5 text-center text-sm text-slate-400">暂无分配任务</p> : data.projectTasks.slice(0, 4).map((task) => <Link key={task.id} href="/user/knowledge" className="block rounded-xl bg-slate-50 p-2.5 transition hover:bg-violet-50"><p className="truncate text-sm font-medium text-slate-700">{task.name}</p><p className="mt-1 truncate text-xs text-slate-400">{task.project.name} · {task.progress}%</p></Link>)}</CardContent></Card></div></div>

      <Card className="border-white/80 bg-white/72 shadow-lg shadow-slate-900/5 backdrop-blur-xl"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="size-5 text-emerald-600" />个人时间线</CardTitle></CardHeader><CardContent>{data.timeline.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">暂无近期安排</p> : <div className="grid gap-2 md:grid-cols-2">{data.timeline.map((item) => <Link key={item.id} href={item.href} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3 transition hover:border-emerald-200 hover:bg-emerald-50"><div className="flex size-9 items-center justify-center rounded-xl bg-white text-emerald-600 shadow-sm"><Clock3 className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-700">{item.title}</p><p className="text-xs text-slate-400">{item.type} · {new Date(item.time).toLocaleString('zh-CN')}</p></div></Link>)}</div>}</CardContent></Card>
    </div>
  );
}

function MemberMetric({ icon: Icon, label, value, hint, tone }: { icon: typeof FileText; label: string; value: number; hint: string; tone: 'blue' | 'cyan' | 'violet' | 'rose' | 'amber' }) { const tones = { blue: 'from-blue-500 to-indigo-500', cyan: 'from-cyan-500 to-teal-500', violet: 'from-violet-500 to-purple-500', rose: 'from-rose-500 to-red-500', amber: 'from-amber-400 to-orange-500' }; return <Card className="border-white/80 bg-white/70 shadow-lg shadow-slate-900/5 backdrop-blur-xl"><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between"><div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-3xl font-black text-slate-900">{value}</p></div><div className={cn('flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg', tones[tone])}><Icon className="size-5" /></div></div><p className={cn('mt-3 text-xs', tone === 'rose' ? 'text-rose-600' : 'text-slate-400')}>{hint}</p></CardContent></Card>; }
function TodoLink({ href, icon: Icon, label, count, danger }: { href: string; icon: typeof FileClock; label: string; count: number; danger?: boolean }) { return <Link href={href} className="flex items-center gap-3 rounded-2xl border border-transparent bg-white/45 p-3 transition hover:border-emerald-200 hover:bg-emerald-50"><div className={cn('flex size-9 items-center justify-center rounded-xl', danger ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600')}><Icon className="size-4" /></div><span className="min-w-0 flex-1 text-sm font-medium text-slate-700">{label}</span><span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', count ? danger ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')}>{count}</span></Link>; }
