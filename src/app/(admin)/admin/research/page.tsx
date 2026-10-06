'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, Atom, Beaker, BookOpen, CalendarRange, CheckCircle2,
  FileClock, FlaskRound, FolderKanban, Loader2, Microscope, Search, Sparkles, Users,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface ResearchProjectCard {
  id: string;
  name: string;
  description: string | null;
  status: string;
  progress: number;
  managers: Array<{ id: string; name: string }>;
  taskCount: number;
  activeTaskCount: number;
  overdueTaskCount: number;
  pendingDocumentCount: number;
  pendingChangeCount: number;
  compoundCount: number;
  recentUpdatedAt: string;
  recentUpdateLabel: string;
}

interface ResearchDashboard {
  projectTotal: number;
  activeProjectCount: number;
  compoundCount: number;
  synthesisBatchCount: number;
  bioAssayCount: number;
  recentCompoundCount: number;
  activeTaskCount: number;
  overdueTaskCount: number;
  pendingDocumentCount: number;
  pendingChangeCount: number;
  recentUpdatedProjects: ResearchProjectCard[];
}

async function fetchResearchDashboard(): Promise<ResearchDashboard> {
  const response = await authFetch('/api/research/dashboard');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '科研数据加载失败');
  return result;
}

export default function ResearchDashboardPage() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['research-dashboard'], queryFn: fetchResearchDashboard });
  const projects = useMemo(() => data?.recentUpdatedProjects.filter((project) => !search || `${project.name} ${project.description || ''}`.toLowerCase().includes(search.toLowerCase())) || [], [data, search]);
  const selected = projects.find((project) => project.id === selectedId) || projects[0];

  if (isLoading) return <div className="flex min-h-[520px] items-center justify-center"><Loader2 className="size-8 animate-spin text-violet-500" /></div>;
  if (!data || error) return <div className="flex min-h-[420px] flex-col items-center justify-center gap-3"><p className="text-sm text-rose-600">{error instanceof Error ? error.message : '科研数据加载失败'}</p><Button variant="outline" onClick={() => void refetch()}>重新加载</Button></div>;

  const reviewTotal = data.pendingDocumentCount + data.pendingChangeCount;
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[28px] border border-white/80 bg-white/65 p-5 shadow-xl shadow-violet-900/5 backdrop-blur-2xl sm:p-6">
        <div className="absolute -right-12 -top-20 size-64 rounded-full bg-violet-300/20 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div><div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-600"><Sparkles className="size-4" />Research workspace</div><h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">科研总览</h2><p className="mt-1 text-sm text-slate-500">聚合课题进展、化合物条目、阶段任务与科研文档更新</p></div>
          <div className="flex gap-2"><Link href="/admin/compounds"><Button variant="outline" className="bg-white/70"><FlaskRound className="size-4" />化合物知识库</Button></Link><Link href="/admin/knowledge"><Button className="bg-gradient-to-r from-violet-600 to-indigo-600"><FolderKanban className="size-4" />进入课题知识库</Button></Link></div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <ResearchMetric icon={FolderKanban} label="课题总数" value={data.projectTotal} hint={`${data.activeProjectCount} 个进行中`} tone="violet" />
        <ResearchMetric icon={FlaskRound} label="化合物知识库" value={data.compoundCount} hint={`近30天更新 ${data.recentCompoundCount} 条`} tone="pink" />
        <ResearchMetric icon={CalendarRange} label="阶段任务" value={data.activeTaskCount} hint={data.overdueTaskCount ? `${data.overdueTaskCount} 项已逾期` : '暂无逾期任务'} tone={data.overdueTaskCount ? 'rose' : 'cyan'} />
        <ResearchMetric icon={FileClock} label="科研待审核" value={reviewTotal} hint={`文档 ${data.pendingDocumentCount} · 修改 ${data.pendingChangeCount}`} tone="amber" />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card className="border-white/80 bg-white/65 shadow-lg shadow-slate-900/5 backdrop-blur-2xl xl:col-span-3">
          <CardHeader><CardTitle className="text-base">近期有更新的课题</CardTitle><div className="relative mt-2"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索课题" className="bg-white/70 pl-9" /></div></CardHeader>
          <CardContent className="max-h-[520px] space-y-2 overflow-y-auto">
            {projects.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">暂无匹配课题</p> : projects.map((project) => <button key={project.id} type="button" onClick={() => setSelectedId(project.id)} className={cn('w-full rounded-2xl border p-3 text-left transition', selected?.id === project.id ? 'border-violet-200 bg-violet-50 shadow-sm' : 'border-transparent bg-white/45 hover:border-slate-200 hover:bg-white')}><div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-slate-800">{project.name}</span>{project.overdueTaskCount > 0 && <span className="size-2 rounded-full bg-rose-500" />}</div><p className="mt-1 line-clamp-1 text-xs text-slate-500">{project.recentUpdateLabel}</p><p className="mt-2 text-[10px] text-slate-400">{new Date(project.recentUpdatedAt).toLocaleString('zh-CN')}</p></button>)}
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden border-white/80 bg-gradient-to-br from-white/80 via-violet-50/65 to-cyan-50/55 shadow-xl shadow-violet-900/5 backdrop-blur-2xl xl:col-span-6">
          <div className="absolute left-1/2 top-20 h-52 w-72 -translate-x-1/2 rounded-full bg-violet-300/20 blur-3xl" />
          <CardHeader className="relative"><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2"><BookOpen className="size-5 text-violet-600" />课题进度卡</CardTitle><span className="text-xs text-slate-400">按最近更新时间排序</span></div></CardHeader>
          <CardContent className="relative">
            {!selected ? <div className="flex min-h-[390px] flex-col items-center justify-center text-slate-400"><FolderKanban className="size-14 opacity-30" /><p className="mt-3 text-sm">暂无科研课题，请先创建课题</p></div> : <div className="mx-auto max-w-xl rounded-[30px] border border-white/90 bg-white/72 p-6 shadow-2xl shadow-violet-900/10 backdrop-blur-2xl sm:p-8"><div className="flex items-start justify-between gap-3"><div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/25"><Atom className="size-6" /></div><Badge variant="outline" className={selected.overdueTaskCount ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-emerald-200 bg-emerald-50 text-emerald-600'}>{selected.overdueTaskCount ? `${selected.overdueTaskCount} 项逾期` : '进度正常'}</Badge></div><h3 className="mt-5 text-xl font-black text-slate-900">{selected.name}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{selected.description || '尚未填写课题简介'}</p><div className="mt-6"><div className="flex justify-between text-sm"><span className="text-slate-500">总体进度</span><span className="font-black text-violet-700">{selected.progress}%</span></div><div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-400" style={{ width: `${selected.progress}%` }} /></div></div><div className="mt-6 grid grid-cols-3 gap-3"><ProjectMini label="阶段任务" value={selected.taskCount} /><ProjectMini label="关联化合物" value={selected.compoundCount} /><ProjectMini label="待审核" value={selected.pendingDocumentCount + selected.pendingChangeCount} /></div><div className="mt-6 flex items-center justify-between gap-3"><div><p className="text-xs text-slate-400">课题管理员</p><div className="mt-2 flex -space-x-2">{selected.managers.map((manager) => <span key={manager.id} title={manager.name} className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white ring-2 ring-white">{manager.name.charAt(0)}</span>)}</div></div><Link href="/admin/knowledge"><Button>查看课题详情<ArrowRight className="size-4" /></Button></Link></div></div>}
          </CardContent>
        </Card>

        <div className="space-y-4 xl:col-span-3">
          <Card className="border-violet-100 bg-gradient-to-br from-violet-600 to-indigo-700 text-white shadow-xl shadow-violet-900/15"><CardHeader><CardTitle className="flex items-center gap-2 text-base text-white"><Sparkles className="size-5 text-violet-200" />科研智能摘要</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-6 text-violet-100"><p>当前共维护 {data.projectTotal} 个课题、{data.compoundCount} 条化合物记录。</p>{data.overdueTaskCount > 0 ? <p className="rounded-xl bg-white/10 p-3">优先关注 {data.overdueTaskCount} 项逾期阶段任务，并核对阻塞原因。</p> : <p className="rounded-xl bg-white/10 p-3">所有阶段任务均未标记逾期。</p>}<p>{reviewTotal > 0 ? `还有 ${reviewTotal} 项科研审批等待处理。` : '当前没有积压的科研审批。'}</p><Link href="/admin/assistant"><Button variant="outline" className="w-full border-white/20 bg-white/10 text-white hover:bg-white/20">打开 AI 助手</Button></Link></CardContent></Card>
          <Card className="border-white/80 bg-white/70 backdrop-blur-xl"><CardHeader><CardTitle className="text-base">科研数据资产</CardTitle></CardHeader><CardContent className="space-y-3"><DataLine icon={Beaker} label="合成批次" value={data.synthesisBatchCount} /><DataLine icon={Microscope} label="活性测试" value={data.bioAssayCount} /><DataLine icon={Users} label="进行中课题" value={data.activeProjectCount} /><DataLine icon={CheckCircle2} label="近期化合物更新" value={data.recentCompoundCount} /></CardContent></Card>
        </div>
      </div>
    </div>
  );
}

function ResearchMetric({ icon: Icon, label, value, hint, tone }: { icon: typeof FolderKanban; label: string; value: number; hint: string; tone: 'violet' | 'pink' | 'cyan' | 'rose' | 'amber' }) {
  const tones = { violet: 'from-violet-500 to-indigo-600', pink: 'from-fuchsia-500 to-pink-500', cyan: 'from-cyan-500 to-blue-500', rose: 'from-rose-500 to-red-500', amber: 'from-amber-400 to-orange-500' };
  return <Card className="overflow-hidden border-white/80 bg-white/68 shadow-lg shadow-slate-900/5 backdrop-blur-xl"><CardContent className="p-4 sm:p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-3xl font-black tracking-tight text-slate-900">{value}</p></div><div className={cn('flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg', tones[tone])}><Icon className="size-5" /></div></div><p className={cn('mt-3 text-xs', tone === 'rose' ? 'text-rose-600' : 'text-slate-400')}>{hint}</p></CardContent></Card>;
}
function ProjectMini({ label, value }: { label: string; value: number }) { return <div className="rounded-2xl bg-slate-50/80 p-3 text-center"><p className="text-xl font-black text-slate-900">{value}</p><p className="text-[11px] text-slate-400">{label}</p></div>; }
function DataLine({ icon: Icon, label, value }: { icon: typeof Beaker; label: string; value: number }) { return <div className="flex items-center gap-3 rounded-xl bg-slate-50/80 p-2.5"><Icon className="size-4 text-violet-500" /><span className="flex-1 text-sm text-slate-600">{label}</span><span className="font-bold text-slate-900">{value}</span></div>; }
