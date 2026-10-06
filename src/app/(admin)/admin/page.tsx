'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, BellRing, CheckCircle2, ClipboardCheck, Clock3, Cpu,
  FileCheck2, FileText, FlaskConical, Inbox, Loader2, Megaphone, ShieldCheck,
  Sparkles, UserPlus, Users, Zap,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ApprovalGroup { key: string; label: string; count: number; href: string }
interface AdminOverview {
  pendingTotal: number;
  highRiskApprovals: number;
  pendingJoinRequests: number;
  todayProcessed: number;
  approvalGroups: ApprovalGroup[];
  safety: { riskEventCount: number; expiringCount: number; expiredCount: number; lowStockCount: number };
  recentActivities: Array<{ id: string; type: string; detail: string; status: string; createdAt: string }>;
}

async function fetchOverview(): Promise<AdminOverview> {
  const response = await authFetch('/api/dashboard/admin');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '管理总览加载失败');
  return result;
}

const groupMeta: Record<string, { icon: typeof FlaskConical; description: string; tone: string }> = {
  requisitions: { icon: FlaskConical, description: '核对库存、风险等级、资质和用途', tone: 'text-cyan-600 bg-cyan-50' },
  reservations: { icon: Cpu, description: '检查设备状态、资质和预约冲突', tone: 'text-indigo-600 bg-indigo-50' },
  documents: { icon: FileCheck2, description: '复核 OCR 票据和结构化入库信息', tone: 'text-amber-600 bg-amber-50' },
  join: { icon: UserPlus, description: '处理管理员与实验员加入实验室申请', tone: 'text-blue-600 bg-blue-50' },
  taskChanges: { icon: ClipboardCheck, description: '审批课题阶段任务修改申请', tone: 'text-violet-600 bg-violet-50' },
  projectDocuments: { icon: FileText, description: '审核课题文档版本并沉淀知识资产', tone: 'text-pink-600 bg-pink-50' },
};

export default function AdminOverviewPage() {
  const user = useAuthStore((state) => state.user);
  const [selectedKey, setSelectedKey] = useState('requisitions');
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard', 'admin', user?.labId], queryFn: fetchOverview });
  const selected = useMemo(() => data?.approvalGroups.find((group) => group.key === selectedKey) || data?.approvalGroups[0], [data, selectedKey]);

  if (isLoading) return <div className="flex min-h-[520px] items-center justify-center"><Loader2 className="size-8 animate-spin text-blue-600" /></div>;
  if (!data || error) return <div className="flex min-h-[420px] flex-col items-center justify-center gap-3"><p className="text-sm text-rose-600">{error instanceof Error ? error.message : '管理总览加载失败'}</p><Button variant="outline" onClick={() => void refetch()}>重新加载</Button></div>;

  const selectedMeta = selected ? groupMeta[selected.key] : undefined;
  const SelectedIcon = selectedMeta?.icon || Inbox;
  const urgentSafety = data.safety.riskEventCount + data.safety.expiredCount;
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border border-white/80 bg-white/68 p-5 shadow-xl shadow-blue-900/5 backdrop-blur-2xl sm:p-6">
        <div className="absolute -right-14 -top-24 size-72 rounded-full bg-blue-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-blue-600"><ShieldCheck className="size-4" />Management overview</div><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">管理总览</h2><p className="mt-1 text-sm text-slate-500">{user?.name || '管理员'} · {user?.labName || '当前实验室'} · 聚焦审批、风险和今日待办</p></div><div className="flex gap-2"><Link href="/admin/review"><Button className="bg-gradient-to-r from-blue-600 to-indigo-600"><Inbox className="size-4" />处理审批</Button></Link><Link href="/admin/announcements"><Button variant="outline" className="bg-white/70"><Megaphone className="size-4" />发布通告</Button></Link></div></div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <OverviewMetric icon={Inbox} label="待审批总数" value={data.pendingTotal} hint="所有当前可处理事项" tone="blue" />
        <OverviewMetric icon={AlertTriangle} label="高风险审批" value={data.highRiskApprovals} hint={data.highRiskApprovals ? '需要优先人工核对' : '暂无高风险申请'} tone={data.highRiskApprovals ? 'rose' : 'emerald'} />
        <OverviewMetric icon={UserPlus} label="入组申请" value={data.pendingJoinRequests} hint="当前实验室待处理" tone="cyan" />
        <OverviewMetric icon={CheckCircle2} label="今日已处理" value={data.todayProcessed} hint="通过、驳回与确认合计" tone="emerald" />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="border-white/80 bg-white/68 shadow-lg shadow-slate-900/5 backdrop-blur-2xl xl:col-span-3"><CardHeader><CardTitle className="text-base">审批分类</CardTitle></CardHeader><CardContent className="space-y-2">{data.approvalGroups.map((group) => { const meta = groupMeta[group.key]; const Icon = meta?.icon || Inbox; return <button key={group.key} type="button" onClick={() => setSelectedKey(group.key)} className={cn('flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition', selected?.key === group.key ? 'border-blue-200 bg-blue-50 shadow-sm' : 'border-transparent bg-white/45 hover:border-slate-200 hover:bg-white')}><div className={cn('flex size-9 items-center justify-center rounded-xl', meta?.tone)}><Icon className="size-4" /></div><span className="min-w-0 flex-1 text-sm font-medium text-slate-700">{group.label}</span><span className={cn('flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold', group.count > 0 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-400')}>{group.count}</span></button>; })}</CardContent></Card>

        <Card className="relative overflow-hidden border-white/80 bg-gradient-to-br from-white/85 via-blue-50/65 to-indigo-50/60 shadow-xl shadow-blue-900/5 backdrop-blur-2xl xl:col-span-6"><div className="absolute left-1/2 top-20 size-64 -translate-x-1/2 rounded-full bg-blue-300/20 blur-3xl" /><CardHeader className="relative"><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2"><Zap className="size-5 text-blue-600" />当前审批任务</CardTitle><span className="text-xs text-slate-400">选择左侧分类切换</span></div></CardHeader><CardContent className="relative min-h-[430px]">{selected && <div className="mx-auto mt-4 max-w-xl rounded-[30px] border border-white/90 bg-white/76 p-6 shadow-2xl shadow-blue-900/10 backdrop-blur-2xl sm:p-8"><div className="flex items-start justify-between"><div className={cn('flex size-14 items-center justify-center rounded-2xl', selectedMeta?.tone)}><SelectedIcon className="size-7" /></div><Badge variant="outline" className={selected.count > 0 ? 'border-orange-200 bg-orange-50 text-orange-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>{selected.count > 0 ? `${selected.count} 项待处理` : '已清空'}</Badge></div><h3 className="mt-6 text-2xl font-black text-slate-900">{selected.label}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{selectedMeta?.description}</p><div className="mt-6 rounded-2xl bg-slate-50/80 p-4"><p className="text-xs font-semibold text-slate-500">审批前建议核对</p><ul className="mt-2 space-y-2 text-sm text-slate-600"><li>• 申请人与目标对象是否属于当前实验室</li><li>• 风险、资质、库存或时间冲突是否符合规则</li><li>• 驳回或退回时填写清晰、可执行的说明</li></ul></div><Link href={selected.href}><Button className="mt-6 w-full">进入处理页面<ArrowRight className="size-4" /></Button></Link></div>}</CardContent></Card>

        <div className="space-y-4 xl:col-span-3"><Card className="border-blue-100 bg-gradient-to-br from-blue-700 to-indigo-800 text-white shadow-xl shadow-blue-900/15"><CardHeader><CardTitle className="flex items-center gap-2 text-base text-white"><Sparkles className="size-5 text-blue-200" />智能审批摘要</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-6 text-blue-100"><p>当前共有 {data.pendingTotal} 项待审批，其中 {data.highRiskApprovals} 项涉及高风险试剂或管制要求。</p>{selected && selected.count > 0 && <p className="rounded-xl bg-white/10 p-3">建议优先处理“{selected.label}”，当前积压 {selected.count} 项。</p>}<p>AI 只辅助梳理风险点，最终审批仍由管理员确认。</p><Link href="/admin/assistant"><Button variant="outline" className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20">询问 AI 助手</Button></Link></CardContent></Card><Card className="border-white/80 bg-white/72 backdrop-blur-xl"><CardHeader><CardTitle className="text-base">安全提醒</CardTitle></CardHeader><CardContent className="space-y-3"><SafetyLine label="未解决风险" value={data.safety.riskEventCount} danger /><SafetyLine label="过期试剂" value={data.safety.expiredCount} danger /><SafetyLine label="30天内临期" value={data.safety.expiringCount} /><SafetyLine label="低库存" value={data.safety.lowStockCount} />{urgentSafety > 0 && <Link href="/admin/reagents"><Button size="sm" variant="outline" className="w-full">查看试剂安全状态</Button></Link>}</CardContent></Card></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3"><Card className="border-white/80 bg-white/72 backdrop-blur-xl lg:col-span-2"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="size-5 text-blue-500" />审批动态</CardTitle></CardHeader><CardContent>{data.recentActivities.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">暂无审批动态</p> : <div className="space-y-1">{data.recentActivities.map((activity) => <div key={`${activity.type}-${activity.id}`} className="flex items-center gap-3 border-b border-slate-100 py-3 last:border-0"><span className="rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{activity.type}</span><span className="min-w-0 flex-1 truncate text-sm text-slate-700">{activity.detail}</span><span className="text-xs text-slate-400">{new Date(activity.createdAt).toLocaleString('zh-CN')}</span></div>)}</div>}</CardContent></Card><Card className="border-white/80 bg-white/72"><CardHeader><CardTitle className="text-base">快捷管理</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2"><QuickLink href="/admin/review" icon={ShieldCheck} label="审批中心" /><QuickLink href="/admin/reagents" icon={FlaskConical} label="试剂票据" /><QuickLink href="/admin/inspections" icon={ClipboardCheck} label="派发巡检" /><QuickLink href="/admin/qualifications" icon={Users} label="人员资质" /><QuickLink href="/admin/equipment" icon={Cpu} label="设备管理" /><QuickLink href="/admin/announcements" icon={BellRing} label="发布通告" /></CardContent></Card></div>
    </div>
  );
}

function OverviewMetric({ icon: Icon, label, value, hint, tone }: { icon: typeof Inbox; label: string; value: number; hint: string; tone: 'blue' | 'rose' | 'cyan' | 'emerald' }) { const tones = { blue: 'from-blue-500 to-indigo-600', rose: 'from-rose-500 to-red-500', cyan: 'from-cyan-500 to-blue-500', emerald: 'from-emerald-500 to-teal-500' }; return <Card className="border-white/80 bg-white/70 shadow-lg shadow-slate-900/5 backdrop-blur-xl"><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between"><div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-3xl font-black text-slate-900">{value}</p></div><div className={cn('flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg', tones[tone])}><Icon className="size-5" /></div></div><p className={cn('mt-3 text-xs', tone === 'rose' ? 'text-rose-600' : 'text-slate-400')}>{hint}</p></CardContent></Card>; }
function SafetyLine({ label, value, danger }: { label: string; value: number; danger?: boolean }) { return <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2.5"><span className={cn('size-2 rounded-full', danger && value > 0 ? 'bg-rose-500' : value > 0 ? 'bg-amber-400' : 'bg-emerald-500')} /><span className="flex-1 text-sm text-slate-600">{label}</span><strong className={danger && value > 0 ? 'text-rose-600' : 'text-slate-800'}>{value}</strong></div>; }
function QuickLink({ href, icon: Icon, label }: { href: string; icon: typeof ShieldCheck; label: string }) { return <Link href={href} className="flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-center transition hover:-translate-y-0.5 hover:border-blue-200 hover:bg-blue-50"><Icon className="size-5 text-blue-600" /><span className="text-xs font-medium text-slate-700">{label}</span></Link>; }
