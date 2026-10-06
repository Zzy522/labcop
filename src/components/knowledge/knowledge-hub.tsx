'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BookOpen, CalendarRange, Check, Download, FileClock,
  FileText, FlaskRound, FolderKanban, History, Loader2, Plus, RefreshCw, Search,
  Pencil, Settings2, ShieldCheck, Upload, UserCog, Users, X, BarChart3, MapPin,
  ClipboardPenLine, Sparkles, Tags, Trash2, Paperclip, DatabaseBackup,
  CircleCheck, CircleDashed,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { weeklyReportSchema, validateWeeklyReportAttachments } from '@/lib/validations/project';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { buildGanttWeekColumns, isCurrentWeek, recentGanttAnchor, taskOverlapsWeek } from '@/lib/research/gantt';

type AccessRole = 'ADMIN' | 'MANAGER' | 'MEMBER';

interface LabMember { id: string; name: string; email: string; role: string }

interface ProjectListItem {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  version: number;
  managers: Array<{ id: string; name: string; email: string }>;
  memberCount: number;
  taskCount: number;
  overdueTaskCount: number;
  pendingDocumentCount: number;
  pendingChangeCount: number;
  compoundCount: number;
  accessRole: AccessRole;
  recentUpdatedAt: string;
}

interface ProjectTask {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  priority: string;
  progress: number;
  estimatedWeeks: number;
  tags: string[];
  blockedReason: string | null;
  version: number;
  createdAt: string;
  assignees: Array<{ id: string; name: string; email: string; isLead: boolean }>;
  updatedAt: string;
  updates: Array<{ id: string; note: string; progress: number; status: string; tags: string[]; createdAt: string; author: { id: string; name: string } }>;
}

interface WeeklyReport {
  id: string;
  weekStart: string;
  title: string;
  content: string;
  blockers: string | null;
  nextPlan: string | null;
  author: { id: string; name: string };
  createdAt: string;
  attachments: WeeklyReportAttachment[];
}

interface WeeklyReportAttachment {
  id: string;
  reportId: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number;
  sha256: string;
  backupReady: boolean;
  createdAt: string;
}

interface AiSummary {
  id: string;
  question: string;
  content: string;
  usedVision: boolean;
  requestedBy: { id: string; name: string };
  createdAt: string;
}

interface ProjectDocumentVersion {
  id: string;
  version: number;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  status: string;
  changeNote: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
}

interface ProjectDocument {
  id: string;
  title: string;
  docType: string;
  description: string | null;
  versions: ProjectDocumentVersion[];
}

interface ChangeRequest {
  id: string;
  status: string;
  reason: string;
  patchData: Record<string, unknown>;
  task: { id: string; name: string; version: number };
  requester: { id: string; name: string };
  reviewer: { id: string; name: string } | null;
  createdAt: string;
}

interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  objective: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  progress: number;
  version: number;
  accessRole: AccessRole;
  canManage: boolean;
  members: Array<LabMember & { projectRole: 'MANAGER' | 'MEMBER'; joinedAt: string }>;
  tasks: ProjectTask[];
  documents: ProjectDocument[];
  compounds: Array<{ id: string; name: string; commonName: string | null; casNumber: string | null; role: string | null; _count: { synthesisBatches: number; bioAssays: number; documents: number } }>;
  changeRequests: ChangeRequest[];
  weeklyReports: WeeklyReport[];
  aiSummaries: AiSummary[];
}

interface HistoryItem {
  id: string;
  entityType: string;
  action: string;
  reason: string | null;
  source: string;
  operator: { id: string; name: string };
  createdAt: string;
}

interface CompoundOption { id: string; name: string; commonName?: string | null; casNumber?: string | null }

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '筹备中', ACTIVE: '进行中', PAUSED: '已暂停', COMPLETED: '已完成', ARCHIVED: '已归档',
  PLANNED: '待开始', IN_PROGRESS: '进行中', BLOCKED: '受阻', CANCELLED: '已取消',
  PENDING_REVIEW: '待审核', APPROVED: '已通过', REJECTED: '已驳回', PENDING: '待审批', CONFLICT: '版本冲突',
};

const statusClass: Record<string, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  COMPLETED: 'border-blue-200 bg-blue-50 text-blue-700',
  IN_PROGRESS: 'border-amber-200 bg-amber-50 text-amber-700',
  BLOCKED: 'border-rose-200 bg-rose-50 text-rose-700',
  PENDING: 'border-orange-200 bg-orange-50 text-orange-700',
  PENDING_REVIEW: 'border-orange-200 bg-orange-50 text-orange-700',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700',
};

async function readJson<T>(response: Response): Promise<T> {
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || '操作失败');
  return json as T;
}

function ProjectStatus({ value }: { value: string }) {
  return <Badge variant="outline" className={cn('text-[11px]', statusClass[value])}>{STATUS_LABELS[value] || value}</Badge>;
}

export function KnowledgeHub({ isAdmin }: { isAdmin: boolean }) {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [labMembers, setLabMembers] = useState<LabMember[]>([]);
  const [compoundOptions, setCompoundOptions] = useState<CompoundOption[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'reports' | 'documents' | 'members' | 'history'>('overview');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [taskDialog, setTaskDialog] = useState<{ task?: ProjectTask; request: boolean } | null>(null);
  const [weeklyReportOpen, setWeeklyReportOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const result = await readJson<{ data: ProjectListItem[] }>(await authFetch('/api/projects'));
      setProjects(result.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '课题加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const result = await readJson<{ data: ProjectDetail }>(await authFetch(`/api/projects/${id}`));
      setDetail(result.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '课题详情加载失败');
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async () => {
    const result = await readJson<{ data: LabMember[] }>(await authFetch('/api/labs/members'));
    setLabMembers(result.data.filter((member) => member.role === 'MEMBER'));
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { if (isAdmin) void loadMembers().catch(() => undefined); }, [isAdmin, loadMembers]);
  useEffect(() => { if (selectedId) void loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  const filtered = useMemo(() => projects.filter((project) => !search || `${project.name} ${project.description || ''}`.toLowerCase().includes(search.toLowerCase())), [projects, search]);
  const stats = useMemo(() => ({
    total: projects.length,
    active: projects.filter((project) => project.status === 'ACTIVE').length,
    overdue: projects.reduce((sum, project) => sum + project.overdueTaskCount, 0),
    pending: projects.reduce((sum, project) => sum + project.pendingDocumentCount + project.pendingChangeCount, 0),
  }), [projects]);

  const openProject = (id: string) => { setSelectedId(id); setActiveTab('overview'); };
  const refreshDetail = async () => { if (selectedId) await loadDetail(selectedId); await loadProjects(); };

  if (loading && !detail && projects.length === 0) {
    return <div className="flex min-h-[360px] items-center justify-center"><Loader2 className="size-7 animate-spin text-amber-500" /></div>;
  }

  if (!selectedId || !detail) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard icon={FolderKanban} label={isAdmin ? '课题总数' : '我的课题'} value={stats.total} tone="amber" />
          <SummaryCard icon={BookOpen} label="进行中课题" value={stats.active} tone="blue" />
          <SummaryCard icon={CalendarRange} label="逾期阶段任务" value={stats.overdue} tone="rose" />
          <SummaryCard icon={FileClock} label="待审批事项" value={stats.pending} tone="violet" />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm backdrop-blur-xl">
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索课题名称或简介" className="pl-9" />
          </div>
          <Button variant="outline" onClick={() => void loadProjects()}><RefreshCw className="size-4" />刷新</Button>
          {isAdmin && <Button onClick={() => setCreateOpen(true)} className="bg-gradient-to-r from-amber-500 to-orange-500"><Plus className="size-4" />新建课题</Button>}
        </div>

        {filtered.length === 0 ? (
          <Card className="border-dashed bg-white/60"><CardContent className="flex min-h-64 flex-col items-center justify-center text-center"><FolderKanban className="size-12 text-slate-300" /><p className="mt-3 font-medium text-slate-600">{isAdmin ? '暂无课题，请创建并指定 1～3 名实验员课题管理员' : '您尚未加入任何课题'}</p></CardContent></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.map((project) => <ProjectCard key={project.id} project={project} onClick={() => openProject(project.id)} />)}
          </div>
        )}
        <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} members={labMembers} onCreated={async () => { setCreateOpen(false); await loadProjects(); }} />
      </div>
    );
  }

  const pendingRequests = detail.changeRequests.filter((item) => item.status === 'PENDING');
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => setSelectedId(null)}><ArrowLeft className="size-5" /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold text-slate-900">{detail.name}</h2><ProjectStatus value={detail.status} /><Badge variant="outline">{detail.accessRole === 'ADMIN' ? '实验室管理员' : detail.accessRole === 'MANAGER' ? '课题管理员' : '课题成员'}</Badge></div>
          <p className="mt-1 text-sm text-slate-500">{detail.description || '尚未填写课题简介'}</p>
        </div>
        <Button variant="outline" onClick={() => setSummaryOpen(true)}><Sparkles className="size-4 text-violet-500" />课题总结</Button>
        <Button variant="outline" onClick={() => setWeeklyReportOpen(true)}><ClipboardPenLine className="size-4 text-sky-500" />提交周报</Button>
        {detail.canManage && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="size-4" />编辑课题</Button>}
        <Button variant="outline" onClick={() => void refreshDetail()}><RefreshCw className="size-4" />刷新</Button>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-white/70 bg-white/70 p-1.5 shadow-sm backdrop-blur-xl">
        <Tab active={activeTab === 'overview'} icon={BookOpen} label="科研概览" onClick={() => setActiveTab('overview')} />
        <Tab active={activeTab === 'tasks'} icon={CalendarRange} label="阶段任务" badge={pendingRequests.length} onClick={() => setActiveTab('tasks')} />
        <Tab active={activeTab === 'reports'} icon={ClipboardPenLine} label="课题周报" badge={detail.weeklyReports.length} onClick={() => setActiveTab('reports')} />
        <Tab active={activeTab === 'documents'} icon={FileText} label="课题文档" badge={detail.documents.filter((doc) => doc.versions[0]?.status === 'PENDING_REVIEW').length} onClick={() => setActiveTab('documents')} />
        <Tab active={activeTab === 'members'} icon={Users} label="成员权限" onClick={() => setActiveTab('members')} />
        <Tab active={activeTab === 'history'} icon={History} label="版本记录" onClick={() => { setActiveTab('history'); void loadProjectHistory(detail.id, setHistory); }} />
      </div>

      {activeTab === 'overview' && <OverviewPanel detail={detail} compoundOptions={compoundOptions} loadCompounds={async () => { const result = await readJson<{ data: CompoundOption[] }>(await authFetch('/api/compounds?pageSize=100')); setCompoundOptions(result.data); }} onLinked={refreshDetail} />}
      {activeTab === 'tasks' && <TasksPanel detail={detail} onOpenTask={setTaskDialog} onDelete={async (task) => { if (!window.confirm(`确认删除任务“${task.name}”吗？任务将从当前视图隐藏，但历史记录仍会保留。`)) return; await readJson(await authFetch(`/api/projects/${detail.id}/tasks/${task.id}`, { method: 'DELETE' })); toast.success('任务已软删除，历史记录仍保留'); await refreshDetail(); }} onReview={async (requestId, decision) => { await reviewTaskChange(detail.id, requestId, decision); await refreshDetail(); }} />}
      {activeTab === 'reports' && <WeeklyReportsPanel detail={detail} isAdmin={isAdmin} />}
      {activeTab === 'documents' && <DocumentsPanel detail={detail} onChanged={refreshDetail} />}
      {activeTab === 'members' && <MembersPanel detail={detail} allMembers={labMembers} isAdmin={isAdmin} onChanged={refreshDetail} />}
      {activeTab === 'history' && <HistoryPanel items={history} />}

      {taskDialog && <TaskDialog project={detail} value={taskDialog.task} request={taskDialog.request} open onOpenChange={(open) => !open && setTaskDialog(null)} onSaved={async () => { setTaskDialog(null); await refreshDetail(); }} />}
      <WeeklyReportDialog projectId={detail.id} open={weeklyReportOpen} onOpenChange={setWeeklyReportOpen} onSaved={async () => { setWeeklyReportOpen(false); setActiveTab('reports'); await refreshDetail(); }} />
      <ProjectSummaryDialog project={detail} isAdmin={isAdmin} open={summaryOpen} onOpenChange={setSummaryOpen} onSaved={refreshDetail} />
      <ProjectEditDialog project={detail} open={editOpen} onOpenChange={setEditOpen} onSaved={async () => { setEditOpen(false); await refreshDetail(); }} />
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, tone }: { icon: typeof FolderKanban; label: string; value: number; tone: 'amber' | 'blue' | 'rose' | 'violet' }) {
  const tones = { amber: 'from-amber-400 to-orange-500', blue: 'from-sky-400 to-blue-600', rose: 'from-rose-400 to-red-500', violet: 'from-violet-400 to-purple-600' };
  return <Card className="overflow-hidden border-white/70 bg-white/70 shadow-sm backdrop-blur-xl"><CardContent className="flex items-center gap-3 p-4"><div className={cn('flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm', tones[tone])}><Icon className="size-5" /></div><div><p className="text-2xl font-black text-slate-900">{value}</p><p className="text-xs text-slate-500">{label}</p></div></CardContent></Card>;
}

function ProjectCard({ project, onClick }: { project: ProjectListItem; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="group overflow-hidden rounded-[24px] border border-white/80 bg-white/72 text-left shadow-sm backdrop-blur-xl transition hover:-translate-y-1 hover:shadow-xl">
    <div className="h-1.5 bg-gradient-to-r from-amber-400 via-orange-400 to-violet-500" />
    <div className="p-5">
      <div className="flex items-start justify-between gap-2"><div className="flex size-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600"><FolderKanban className="size-5" /></div><ProjectStatus value={project.status} /></div>
      <h3 className="mt-3 line-clamp-1 font-bold text-slate-900">{project.name}</h3><p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">{project.description || '暂无课题简介'}</p>
      <div className="mt-4"><div className="flex justify-between text-xs"><span className="text-slate-400">课题进度</span><span className="font-semibold text-amber-600">{project.progress}%</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-500" style={{ width: `${project.progress}%` }} /></div></div>
      <div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>{project.taskCount} 项任务 · {project.compoundCount} 个化合物</span><span>{project.memberCount} 名成员</span></div>
      <div className="mt-3 flex items-center justify-between"><div className="flex -space-x-2">{project.managers.map((manager) => <span key={manager.id} title={`课题管理员：${manager.name}`} className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-[10px] font-bold text-white ring-2 ring-white">{manager.name.charAt(0)}</span>)}</div><div className="flex gap-1">{project.overdueTaskCount > 0 && <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-600">逾期 {project.overdueTaskCount}</Badge>}{project.pendingChangeCount + project.pendingDocumentCount > 0 && <Badge variant="outline" className="border-orange-200 bg-orange-50 text-orange-600">待审 {project.pendingChangeCount + project.pendingDocumentCount}</Badge>}</div></div>
    </div>
  </button>;
}

function OverviewPanel({ detail, compoundOptions, loadCompounds, onLinked }: { detail: ProjectDetail; compoundOptions: CompoundOption[]; loadCompounds: () => Promise<void>; onLinked: () => Promise<void> }) {
  const [selectedCompound, setSelectedCompound] = useState('');
  const completed = detail.tasks.filter((task) => task.status === 'COMPLETED').length;
  return <div className="grid gap-4 lg:grid-cols-3">
    <Card className="lg:col-span-2 border-white/70 bg-white/75 backdrop-blur-xl"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-violet-500" />课题态势</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm leading-7 text-slate-600">{detail.objective || detail.description || '尚未填写研究目标。课题管理员可在后续设置中补充。'}</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><MiniMetric label="总体进度" value={`${detail.progress}%`} /><MiniMetric label="阶段任务" value={`${completed}/${detail.tasks.length}`} /><MiniMetric label="关联化合物" value={String(detail.compounds.length)} /><MiniMetric label="文档版本" value={String(detail.documents.reduce((sum, document) => sum + document.versions.length, 0))} /></div></CardContent></Card>
    <Card className="border-violet-100 bg-gradient-to-br from-violet-50/90 to-white"><CardHeader><CardTitle className="text-base">科研摘要</CardTitle></CardHeader><CardContent className="text-sm leading-6 text-slate-600">当前课题完成度 {detail.progress}%。{detail.tasks.filter((task) => task.status === 'BLOCKED').length > 0 ? `有 ${detail.tasks.filter((task) => task.status === 'BLOCKED').length} 项任务受阻，建议优先处理。` : '当前没有标记为受阻的阶段任务。'} {detail.documents.filter((document) => document.versions[0]?.status === 'PENDING_REVIEW').length} 份最新文档待审核。</CardContent></Card>
    <Card className="lg:col-span-3 border-white/70 bg-white/75"><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle className="flex items-center gap-2"><FlaskRound className="size-5 text-pink-500" />关联化合物</CardTitle>{detail.canManage && <div className="flex gap-2"><select value={selectedCompound} onFocus={() => compoundOptions.length === 0 && void loadCompounds()} onChange={(event) => setSelectedCompound(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">选择化合物</option>{compoundOptions.map((compound) => <option key={compound.id} value={compound.id}>{compound.name}{compound.casNumber ? ` · ${compound.casNumber}` : ''}</option>)}</select><Button size="sm" disabled={!selectedCompound} onClick={async () => { await readJson(await authFetch(`/api/projects/${detail.id}/compounds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ compoundId: selectedCompound }) })); setSelectedCompound(''); await onLinked(); }}>关联</Button></div>}</div></CardHeader><CardContent>{detail.compounds.length === 0 ? <p className="py-6 text-center text-sm text-slate-400">尚未关联化合物</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{detail.compounds.map((compound) => <div key={compound.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3"><p className="font-semibold text-slate-800">{compound.name}</p><p className="text-xs text-slate-400">{compound.casNumber || compound.commonName || '无 CAS/通用名'}</p><p className="mt-2 text-xs text-slate-500">合成批次 {compound._count.synthesisBatches} · 活性测试 {compound._count.bioAssays} · 文档 {compound._count.documents}</p></div>)}</div>}</CardContent></Card>
  </div>;
}

function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-slate-50 p-3"><p className="text-xl font-black text-slate-900">{value}</p><p className="text-xs text-slate-400">{label}</p></div>; }

function TasksPanel({ detail, onOpenTask, onDelete, onReview }: { detail: ProjectDetail; onOpenTask: (value: { task?: ProjectTask; request: boolean }) => void; onDelete: (task: ProjectTask) => Promise<void>; onReview: (id: string, decision: 'APPROVED' | 'REJECTED') => Promise<void> }) {
  const pending = detail.changeRequests.filter((item) => item.status === 'PENDING');
  const [anchored, setAnchored] = useState(false);
  const weeks = buildGanttWeekColumns(detail.tasks, detail.startDate, detail.endDate, 16, anchored ? recentGanttAnchor() : null);
  const gridTemplateColumns = weeks.map((week) => week.compressed ? 'minmax(112px, 1.35fr)' : 'minmax(76px, 1fr)').join(' ');
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 font-bold text-slate-900"><BarChart3 className="size-5 text-violet-500" />周粒度阶段任务甘特图</h3><p className="text-xs text-slate-500">每格为一个自然周；长周期仅压缩中间时间轴，真实任务日期与版本记录保持不变 · 当前 {isoWeekValue(new Date().toISOString())}</p></div><div className="flex items-center gap-2"><Button size="sm" variant={anchored ? 'default' : 'outline'} className={anchored ? 'bg-amber-500 hover:bg-amber-600' : 'text-amber-600'} onClick={() => setAnchored((value) => !value)}>{anchored ? <Check className="size-4" /> : <MapPin className="size-4" />}{anchored ? '已定位近期' : '定位近期'}</Button>{detail.canManage && <Button onClick={() => onOpenTask({ request: false })}><Plus className="size-4" />新增任务</Button>}</div></div>
    {detail.canManage && pending.length > 0 && <Card className="border-orange-200 bg-orange-50/60"><CardHeader><CardTitle className="text-base">待审批修改申请</CardTitle></CardHeader><CardContent className="space-y-2">{pending.map((request) => <div key={request.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3"><div className="min-w-0 flex-1"><p className="font-medium text-slate-800">{request.task.name}</p><p className="text-xs text-slate-500">{request.requester.name}：{request.reason}</p></div><Button size="sm" className="bg-emerald-600" onClick={() => void onReview(request.id, 'APPROVED')}><Check className="size-4" />通过</Button><Button size="sm" variant="outline" className="text-rose-600" onClick={() => void onReview(request.id, 'REJECTED')}><X className="size-4" />驳回</Button></div>)}</CardContent></Card>}
    {detail.tasks.length === 0 ? <Card><CardContent className="py-14 text-center text-sm text-slate-400">暂无阶段任务</CardContent></Card> : <Card className="overflow-hidden border-white/70 bg-white/80"><CardContent className="p-0"><div className="overflow-x-auto"><div className="min-w-[1040px]">
      <div className="grid border-b border-slate-200 bg-slate-50/90" style={{ gridTemplateColumns: '340px minmax(700px, 1fr)' }}><div className="border-r border-slate-200 px-4 py-3 text-xs font-semibold text-slate-500">任务 · 执行人 · 完成度</div><div className="grid" style={{ gridTemplateColumns }}>{weeks.map((week) => { const current = isCurrentWeek(week); return <div key={week.key} className={cn('relative border-r border-slate-200 px-1 py-3 text-center text-[11px] font-medium last:border-r-0', week.compressed ? 'bg-violet-50 text-violet-700' : current ? 'bg-amber-100 text-amber-800' : 'text-slate-500')} title={`${new Date(week.start).toLocaleDateString('zh-CN')} 至 ${new Date(week.end).toLocaleDateString('zh-CN')}`}>{week.compressed ? `≈ ${week.spanWeeks} 周` : current ? <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-amber-500" />本周 {week.label}</span> : week.label}{current && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-amber-500" />}</div>; })}</div></div>
      {detail.tasks.map((task) => { const latest = task.updates[0]; return <div key={task.id} className="grid border-b border-slate-100 last:border-b-0" style={{ gridTemplateColumns: '340px minmax(700px, 1fr)' }}><div className="border-r border-slate-200 p-3"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="font-semibold text-slate-800">{task.name}</p><ProjectStatus value={task.status} /><span className="text-[10px] text-slate-400">v{task.version}</span></div><p className="mt-1 text-xs text-slate-500">{task.assignees.map((item) => item.name).join('、') || '未分配执行人'} · {formatTaskRange(task)}</p>{task.tags.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{task.tags.map((tag) => <Badge key={tag} variant="outline" className="h-5 bg-slate-50 px-1.5 text-[10px]"><Tags className="mr-1 size-2.5" />{tag}</Badge>)}</div>}{latest && <p className="mt-2 line-clamp-2 rounded-lg bg-violet-50/70 px-2 py-1.5 text-[11px] text-violet-700"><strong>{latest.author.name}</strong>：{latest.note}</p>}</div><div className="flex shrink-0 flex-col gap-1"><Button size="sm" variant="ghost" onClick={() => onOpenTask({ task, request: !detail.canManage })}>{detail.canManage ? '编辑' : '申请'}</Button>{detail.accessRole === 'ADMIN' && <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => void onDelete(task)}><Trash2 className="size-3.5" />删除</Button>}</div></div></div><div className="grid items-stretch" style={{ gridTemplateColumns }}>{weeks.map((week) => { const active = taskOverlapsWeek(task, week); const current = isCurrentWeek(week); return <div key={week.key} className={cn('relative min-h-[112px] border-r border-slate-100 p-1 last:border-r-0', week.compressed && 'bg-violet-50/30', current && 'bg-amber-50/60')}><div className={cn('flex h-full min-h-10 items-center justify-center rounded-md text-[11px] font-semibold transition', active ? task.status === 'BLOCKED' ? 'bg-rose-100 text-rose-700' : task.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-gradient-to-r from-violet-100 to-sky-100 text-violet-700' : 'text-transparent')}>{active ? `${task.progress}%${week.compressed ? ' · 压缩段' : ''}` : '—'}</div></div>; })}</div></div>; })}
      <div className="flex flex-wrap gap-4 bg-slate-50/70 px-4 py-3 text-[11px] text-slate-500"><span>完成度仅支持 0 / 20 / 40 / 60 / 80 / 100%</span><span>紫蓝：进行/计划</span><span>绿色：完成</span><span>红色：受阻</span><span className="text-amber-600"><span className="mr-1 inline-block size-2 rounded-full bg-amber-500" />本周</span></div>
    </div></div></CardContent></Card>}
  </div>;
}

function formatTaskRange(task: ProjectTask): string {
  const start = task.startDate ? `开始周 ${new Date(task.startDate).toLocaleDateString('zh-CN')}` : '开始周未设置';
  return `${start} · 预计 ${task.estimatedWeeks || 1} 周`;
}

function DocumentsPanel({ detail, onChanged }: { detail: ProjectDetail; onChanged: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null); const [title, setTitle] = useState(''); const [uploading, setUploading] = useState(false);
  const upload = async () => { if (!file) return; setUploading(true); try { const form = new FormData(); form.set('file', file); form.set('title', title || file.name); await readJson(await authFetch(`/api/projects/${detail.id}/documents`, { method: 'POST', body: form })); setFile(null); setTitle(''); toast.success('文档已提交审核'); await onChanged(); } catch (error) { toast.error(error instanceof Error ? error.message : '上传失败'); } finally { setUploading(false); } };
  const review = async (versionId: string, decision: 'APPROVED' | 'REJECTED') => { await readJson(await authFetch(`/api/projects/${detail.id}/documents/${versionId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })); await onChanged(); };
  return <div className="space-y-4"><Card className="border-dashed border-2 border-violet-200 bg-violet-50/40"><CardContent className="grid gap-3 p-5 sm:grid-cols-[1fr_1fr_auto]"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="文档标题（可选）" /><Input type="file" onChange={(event) => setFile(event.target.files?.[0] || null)} /><Button disabled={!file || uploading} onClick={() => void upload()}>{uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}上传并提交审核</Button></CardContent></Card>{detail.documents.length === 0 ? <Card><CardContent className="py-14 text-center text-sm text-slate-400">暂无课题文档</CardContent></Card> : <div className="space-y-3">{detail.documents.map((document) => { const latest = document.versions[0]; return <Card key={document.id}><CardContent className="flex flex-wrap items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600"><FileText className="size-5" /></div><div className="min-w-[220px] flex-1"><p className="font-semibold text-slate-800">{document.title}</p><p className="text-xs text-slate-500">{latest?.fileName} · v{latest?.version || 0} · {latest?.uploadedBy.name}</p></div>{latest && <ProjectStatus value={latest.status} />}{latest && <Button size="sm" variant="ghost" onClick={() => void downloadProjectDocument(detail.id, latest)}><Download className="size-4" />下载</Button>}{detail.canManage && latest?.status === 'PENDING_REVIEW' && <><Button size="sm" className="bg-emerald-600" onClick={() => void review(latest.id, 'APPROVED')}>通过</Button><Button size="sm" variant="outline" className="text-rose-600" onClick={() => void review(latest.id, 'REJECTED')}>驳回</Button></>}</CardContent></Card>; })}</div>}</div>;
}

function MembersPanel({ detail, allMembers, isAdmin, onChanged }: { detail: ProjectDetail; allMembers: LabMember[]; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const [managers, setManagers] = useState(detail.members.filter((member) => member.projectRole === 'MANAGER').map((member) => member.id)); const [members, setMembers] = useState(detail.members.filter((member) => member.projectRole === 'MEMBER').map((member) => member.id));
  useEffect(() => { setManagers(detail.members.filter((member) => member.projectRole === 'MANAGER').map((member) => member.id)); setMembers(detail.members.filter((member) => member.projectRole === 'MEMBER').map((member) => member.id)); }, [detail]);
  const toggle = (id: string, role: 'MANAGER' | 'MEMBER') => { if (role === 'MANAGER') { setManagers((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 3 ? [...current, id] : current); setMembers((current) => current.filter((value) => value !== id)); } else { setMembers((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); setManagers((current) => current.filter((value) => value !== id)); } };
  const save = async () => { try { await readJson(await authFetch(`/api/projects/${detail.id}/members`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ managerIds: managers, memberIds: members }) })); toast.success('课题成员权限已更新'); await onChanged(); } catch (error) { toast.error(error instanceof Error ? error.message : '保存失败'); } };
  if (!isAdmin) return <div className="grid gap-3 md:grid-cols-2">{detail.members.map((member) => <Card key={member.id}><CardContent className="flex items-center gap-3 p-4"><div className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 font-bold text-white">{member.name.charAt(0)}</div><div><p className="font-semibold text-slate-800">{member.name}</p><p className="text-xs text-slate-500">{member.projectRole === 'MANAGER' ? '课题管理员' : '课题成员'}</p></div></CardContent></Card>)}</div>;
  return <div className="space-y-4"><div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4 text-sm text-slate-600"><UserCog className="mr-2 inline size-4 text-violet-600" />每个课题必须保留 1～3 名实验员课题管理员。只有实验室管理员可调整该权限。</div><div className="grid gap-3 md:grid-cols-2">{allMembers.map((member) => <Card key={member.id}><CardContent className="flex items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="font-semibold text-slate-800">{member.name}</p><p className="truncate text-xs text-slate-400">{member.email}</p></div><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={managers.includes(member.id)} onChange={() => toggle(member.id, 'MANAGER')} />管理员</label><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={members.includes(member.id)} onChange={() => toggle(member.id, 'MEMBER')} />成员</label></CardContent></Card>)}</div><div className="flex justify-end"><Button disabled={managers.length < 1 || managers.length > 3} onClick={() => void save()}><Settings2 className="size-4" />保存成员权限</Button></div></div>;
}

function HistoryPanel({ items }: { items: HistoryItem[] }) { return <Card><CardHeader><CardTitle>追加式版本记录</CardTitle></CardHeader><CardContent>{items.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">暂无历史记录</p> : <div className="space-y-1">{items.map((item) => <div key={item.id} className="flex gap-3 border-b border-slate-100 py-3 last:border-0"><div className="mt-1 size-2 rounded-full bg-violet-500" /><div className="min-w-0 flex-1"><p className="text-sm text-slate-700"><strong>{item.operator.name}</strong> · {item.entityType} · {item.action}</p><p className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString('zh-CN')} · {item.source === 'APPROVED_REQUEST' ? '审批申请应用' : '直接修改'}{item.reason ? ` · ${item.reason}` : ''}</p></div></div>)}</div>}</CardContent></Card>; }

function Tab({ active, icon: Icon, label, badge, onClick }: { active: boolean; icon: typeof BookOpen; label: string; badge?: number; onClick: () => void }) { return <button type="button" onClick={onClick} className={cn('flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition', active ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white')}><Icon className="size-4" />{label}{badge ? <span className={cn('rounded-full px-1.5 text-[10px]', active ? 'bg-white/20' : 'bg-orange-100 text-orange-600')}>{badge}</span> : null}</button>; }

function CreateProjectDialog({ open, onOpenChange, members, onCreated }: { open: boolean; onOpenChange: (value: boolean) => void; members: LabMember[]; onCreated: () => Promise<void> }) {
  const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [managerIds, setManagerIds] = useState<string[]>([]); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (managerIds.length < 1) return toast.error('请选择 1～3 名实验员课题管理员'); setSaving(true); try { await readJson(await authFetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, status: 'DRAFT', managerIds, memberIds: [] }) })); setName(''); setDescription(''); setManagerIds([]); toast.success('课题已创建'); await onCreated(); } catch (error) { toast.error(error instanceof Error ? error.message : '创建失败'); } finally { setSaving(false); } };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>新建科研课题</DialogTitle><p className="text-sm text-slate-500">创建时必须指定 1～3 名实验员课题管理员</p></DialogHeader><div><Label className="mb-2">课题名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} required /></div><div><Label className="mb-2">课题简介</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></div><div><Label className="mb-2">课题管理员（{managerIds.length}/3）</Label><div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">{members.map((member) => <label key={member.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"><input type="checkbox" checked={managerIds.includes(member.id)} onChange={() => setManagerIds((current) => current.includes(member.id) ? current.filter((value) => value !== member.id) : current.length < 3 ? [...current, member.id] : current)} /><span className="text-sm">{member.name}</span><span className="ml-auto text-xs text-slate-400">{member.email}</span></label>)}</div></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving || managerIds.length < 1}>{saving && <Loader2 className="size-4 animate-spin" />}创建课题</Button></DialogFooter></form></DialogContent></Dialog>;
}

function ProjectEditDialog({ project, open, onOpenChange, onSaved }: { project: ProjectDetail; open: boolean; onOpenChange: (value: boolean) => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description || '');
  const [objective, setObjective] = useState(project.objective || '');
  const [status, setStatus] = useState(project.status);
  const [startDate, setStartDate] = useState(project.startDate?.slice(0, 10) || '');
  const [endDate, setEndDate] = useState(project.endDate?.slice(0, 10) || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setDescription(project.description || '');
    setObjective(project.objective || '');
    setStatus(project.status);
    setStartDate(project.startDate?.slice(0, 10) || '');
    setEndDate(project.endDate?.slice(0, 10) || '');
  }, [open, project]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await readJson(await authFetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || null,
          objective: objective || null,
          status,
          startDate: startDate ? new Date(`${startDate}T12:00:00`).toISOString() : null,
          endDate: endDate ? new Date(`${endDate}T12:00:00`).toISOString() : null,
          version: project.version,
        }),
      }));
      toast.success('课题信息已保存并生成新版本');
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '课题保存失败');
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>编辑课题业务信息</DialogTitle><p className="text-sm text-slate-500">保存后版本号递增，旧版本和修改人不会被覆盖。</p></DialogHeader><div><Label>课题名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} required /></div><div><Label>课题简介</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} /></div><div><Label>研究目标与计划</Label><Textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={4} /></div><div className="grid grid-cols-2 gap-3"><div><Label>开始日期</Label><Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></div><div><Label>结束日期</Label><Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></div></div><div><Label>课题状态</Label><select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-2"><option value="DRAFT">筹备中</option><option value="ACTIVE">进行中</option><option value="PAUSED">已暂停</option><option value="COMPLETED">已完成</option>{project.accessRole === 'ADMIN' && <option value="ARCHIVED">已归档</option>}</select></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}保存新版本</Button></DialogFooter></form></DialogContent></Dialog>;
}

function isoWeekValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekValueToIso(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(januaryFourth);
  firstMonday.setUTCDate(januaryFourth.getUTCDate() - (januaryFourth.getUTCDay() || 7) + 1 + (week - 1) * 7);
  return firstMonday.toISOString();
}

function TaskDialog({ project, value, request, open, onOpenChange, onSaved }: { project: ProjectDetail; value?: ProjectTask; request: boolean; open: boolean; onOpenChange: (value: boolean) => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(value?.name || '');
  const [description, setDescription] = useState(value?.description || '');
  const [startWeek, setStartWeek] = useState(isoWeekValue(value?.startDate));
  const [estimatedWeeks, setEstimatedWeeks] = useState(value?.estimatedWeeks || 1);
  const [status, setStatus] = useState(value?.status || 'PLANNED');
  const [progress, setProgress] = useState(Math.min(100, Math.max(0, Math.round((value?.progress || 0) / 20) * 20)));
  const [taskTag, setTaskTag] = useState(['筹备', '进行', '等待', '完成'].includes(value?.tags?.[0] || '') ? value!.tags[0] : '筹备');
  const [stageNote, setStageNote] = useState('');
  const [assigneeIds, setAssigneeIds] = useState(value?.assignees.map((item) => item.id) || []);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (estimatedWeeks < 1 || estimatedWeeks > 260) return toast.error('预计时长应为 1～260 周');
    setSaving(true);
    try {
      const payload = {
        name,
        description,
        startDate: weekValueToIso(startWeek),
        estimatedWeeks: Number(estimatedWeeks),
        status,
        progress: Number(progress),
        tags: [taskTag],
        stageNote: stageNote || undefined,
        assigneeIds,
        leadAssigneeId: assigneeIds[0] || null,
        ...(value ? { version: value.version } : {}),
        ...(request ? { baseVersion: value!.version, reason } : {}),
      };
      const url = request ? `/api/projects/${project.id}/tasks/${value!.id}/change-requests` : value ? `/api/projects/${project.id}/tasks/${value.id}` : `/api/projects/${project.id}/tasks`;
      const method = request || !value ? 'POST' : 'PATCH';
      await readJson(await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }));
      toast.success(request ? '修改申请已提交' : '阶段任务已保存');
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally { setSaving(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><form onSubmit={submit} className="space-y-4"><DialogHeader><DialogTitle>{request ? '申请修改阶段任务' : value ? '编辑阶段任务' : '新增阶段任务'}</DialogTitle><p className="text-sm text-slate-500">任务以自然周排期；预计结束周由“开始周 + 预计时长”自动计算，完成度按 20% 档位更新。</p></DialogHeader><div><Label>任务名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} required /></div><div><Label>任务说明</Label><Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} /></div><div className="grid gap-3 sm:grid-cols-3"><div><Label>开始时间（周）</Label><Input type="week" value={startWeek} onChange={(event) => setStartWeek(event.target.value)} /></div><div><Label>预计时长（周）</Label><Input type="number" min={1} max={260} value={estimatedWeeks} onChange={(event) => setEstimatedWeeks(Number(event.target.value))} required /></div><div><Label>课题任务状态</Label><select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-2"><option value="PLANNED">待开始</option><option value="IN_PROGRESS">进行中</option><option value="BLOCKED">受阻</option><option value="COMPLETED">已完成</option><option value="CANCELLED">已取消</option></select></div></div><div><Label>完成度</Label><div className="mt-1 grid grid-cols-6 gap-1">{[0, 20, 40, 60, 80, 100].map((value) => <button key={value} type="button" onClick={() => setProgress(value)} className={cn('rounded-lg border px-2 py-2 text-xs font-semibold transition', progress === value ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-violet-300')}>{value}%</button>)}</div></div><div><Label>任务标签</Label><select value={taskTag} onChange={(event) => setTaskTag(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3"><option value="筹备">筹备</option><option value="进行">进行</option><option value="等待">等待</option><option value="完成">完成</option></select></div><div><Label>阶段性说明</Label><Textarea value={stageNote} onChange={(event) => setStageNote(event.target.value)} rows={3} placeholder="记录本阶段完成内容、实验现象、阻塞事项或标签变更原因" /><p className="mt-1 text-[11px] text-slate-400">填写后将作为新的追加式任务动态保留，不覆盖旧说明。</p></div><div><Label>任务执行人</Label><div className="mt-1 max-h-32 space-y-1 overflow-y-auto rounded-xl border p-2">{project.members.map((member) => <label key={member.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={assigneeIds.includes(member.id)} onChange={() => setAssigneeIds((current) => current.includes(member.id) ? current.filter((id) => id !== member.id) : [...current, member.id])} />{member.name}{assigneeIds[0] === member.id && <Badge variant="outline" className="ml-auto text-[10px]">主负责人</Badge>}</label>)}</div></div>{request && <div><Label>修改理由</Label><Textarea value={reason} onChange={(event) => setReason(event.target.value)} required rows={2} /></div>}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}{request ? '提交申请' : '保存'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function WeeklyReportsPanel({ detail, isAdmin }: { detail: ProjectDetail; isAdmin: boolean }) {
  const reports = detail.weeklyReports;
  const currentWeek = currentMondayInput();
  const weeks = Array.from(new Set([currentWeek, ...reports.map((report) => new Date(report.weekStart).toISOString().slice(0, 10))])).sort().reverse();
  return <div className="space-y-4">
    {isAdmin && <Card className="border-violet-100 bg-gradient-to-br from-violet-50/80 to-white"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><DatabaseBackup className="size-5 text-violet-600" />实验员周报提交情况</CardTitle><p className="text-xs text-slate-500">按周核对全部课题实验员；附件同时保存原文件、校验值和独立备份副本。</p></CardHeader><CardContent className="grid gap-3 lg:grid-cols-2">{weeks.map((week) => { const weekly = reports.filter((report) => new Date(report.weekStart).toISOString().slice(0, 10) === week); const submittedIds = new Set(weekly.map((report) => report.author.id)); const submitted = detail.members.filter((member) => submittedIds.has(member.id)); const missing = detail.members.filter((member) => !submittedIds.has(member.id)); return <div key={week} className="rounded-2xl border border-white bg-white/80 p-4 shadow-sm"><div className="flex items-center justify-between"><p className="font-semibold text-slate-800">{new Date(`${week}T00:00:00`).toLocaleDateString('zh-CN')} 当周</p><Badge variant="outline" className={missing.length === 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>{submitted.length}/{detail.members.length} 已提交</Badge></div><div className="mt-3 space-y-2"><div className="flex items-start gap-2 text-xs text-emerald-700"><CircleCheck className="mt-0.5 size-4 shrink-0" /><span><strong>已提交：</strong>{submitted.map((member) => member.name).join('、') || '暂无'}</span></div><div className="flex items-start gap-2 text-xs text-amber-700"><CircleDashed className="mt-0.5 size-4 shrink-0" /><span><strong>未提交：</strong>{missing.map((member) => member.name).join('、') || '无'}</span></div></div></div>; })}</CardContent></Card>}
    {reports.length === 0 ? <Card><CardContent className="py-14 text-center text-sm text-slate-400">尚未提交课题周报</CardContent></Card> : reports.map((report) => <Card key={report.id} className="border-white/70 bg-white/80"><CardContent className="p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><ClipboardPenLine className="size-4 text-sky-500" /><h3 className="font-semibold text-slate-800">{report.title}</h3></div><p className="mt-1 text-xs text-slate-400">{report.author.name} · 周起始 {new Date(report.weekStart).toLocaleDateString('zh-CN')} · 提交于 {new Date(report.createdAt).toLocaleString('zh-CN')}</p></div><Badge variant="outline" className="bg-sky-50 text-sky-700">已提交</Badge></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">{report.content}</p>{report.blockers && <div className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><strong>阻塞事项：</strong>{report.blockers}</div>}{report.nextPlan && <div className="mt-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700"><strong>下周计划：</strong>{report.nextPlan}</div>}{report.attachments.length > 0 && <div className="mt-4 border-t border-slate-100 pt-3"><p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-500"><Paperclip className="size-3.5" />附件（{report.attachments.length}）</p><div className="flex flex-wrap gap-2">{report.attachments.map((file) => <Button key={file.id} size="sm" variant="outline" onClick={() => void downloadWeeklyReportAttachment(detail.id, report.id, file)}><Download className="size-3.5" />{file.fileName}<span className="text-[10px] text-emerald-600">{file.backupReady ? '已备份' : ''}</span></Button>)}</div></div>}</CardContent></Card>)}
  </div>;
}

function currentMondayInput(): string {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function WeeklyReportDialog({ projectId, open, onOpenChange, onSaved }: { projectId: string; open: boolean; onOpenChange: (value: boolean) => void; onSaved: () => Promise<void> }) {
  const [weekStart, setWeekStart] = useState(currentMondayInput());
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [blockers, setBlockers] = useState('');
  const [nextPlan, setNextPlan] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitError('');
    const date = new Date(`${weekStart}T12:00:00`);
    const parsed = weeklyReportSchema.safeParse({
      weekStart: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
      title, content, blockers, nextPlan,
    });
    const error = !parsed.success
      ? parsed.error.issues.map((issue) => issue.message).join('；')
      : validateWeeklyReportAttachments(attachments);
    if (error || !parsed.success) {
      setSubmitError(error || '请检查周报内容');
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      Object.entries(parsed.data).forEach(([key, value]) => { if (value !== undefined) form.set(key, value); });
      attachments.forEach((file) => form.append('attachments', file));
      await readJson(await authFetch(`/api/projects/${projectId}/weekly-reports`, { method: 'POST', body: form }));
      toast.success('课题周报、附件和即时备份已保存');
      setTitle(''); setContent(''); setBlockers(''); setNextPlan(''); setAttachments([]);
      await onSaved();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '周报提交失败');
    } finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><form onSubmit={submit} noValidate className="space-y-4"><DialogHeader><DialogTitle>提交课题周报</DialogTitle><p className="text-sm text-slate-500">管理员和课题成员均可提交；文字、附件、校验值和备份快照会追加保存，不覆盖历史内容。</p></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><div><Label>周起始日期 <span className="text-red-500">*</span></Label><Input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} required /></div><div><Label>周报标题 <span className="text-red-500">*</span>（2～120 字符）</Label><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="如：第 12 周研究进展" required /></div></div><div><Label>本周进展 <span className="text-red-500">*</span>（10～12000 字符）</Label><Textarea value={content} onChange={(event) => setContent(event.target.value)} rows={6} minLength={10} required /><p className="mt-1 text-xs text-slate-500">上传 PPT 等附件后仍需填写至少 10 个字符的进展说明，不含首尾空白。</p></div><div><Label>阻塞事项（可选）</Label><Textarea value={blockers} onChange={(event) => setBlockers(event.target.value)} rows={2} /></div><div><Label>下周计划（可选）</Label><Textarea value={nextPlan} onChange={(event) => setNextPlan(event.target.value)} rows={2} /></div><div><Label>周报附件（最多 8 个，单个 15MB，合计 50MB）</Label><Input type="file" multiple onChange={(event) => setAttachments(Array.from(event.target.files || []))} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,image/*" />{attachments.length > 0 && <p className="mt-1 text-xs text-violet-600">已选择：{attachments.map((file) => file.name).join('、')}</p>}<p className="mt-1 text-[11px] text-slate-400">提交时自动生成 SHA-256 校验值，并保存原文件与独立备份副本。</p></div>{submitError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{submitError}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}提交并备份</Button></DialogFooter></form></DialogContent></Dialog>;
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
}

function ProjectSummaryDialog({ project, isAdmin, open, onOpenChange, onSaved }: { project: ProjectDetail; isAdmin: boolean; open: boolean; onOpenChange: (value: boolean) => void; onSaved: () => Promise<void> }) {
  const [question, setQuestion] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [content, setContent] = useState('');
  const [contextInfo, setContextInfo] = useState('');
  const [generating, setGenerating] = useState(false);
  const generate = async () => {
    if (images.some((file) => file.size > 5 * 1024 * 1024)) return toast.error('单张图片不能超过 5MB');
    setGenerating(true); setContent(''); setContextInfo('正在整理任务、周报与内部文档…');
    try {
      const imagePayload = await Promise.all(images.map(async (file) => ({ name: file.name, dataUrl: await fileToDataUrl(file) })));
      const response = await authFetch(`/api/projects/${project.id}/summary`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: question || undefined, images: imagePayload }) });
      if (!response.ok) { const error = await response.json().catch(() => ({})); throw new Error(error.error || '课题总结生成失败'); }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取课题总结响应');
      const decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n'); buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find((item) => item.startsWith('data:'));
          if (!line) continue;
          const data = JSON.parse(line.slice(5).trim());
          if (data.stage === 'context') setContextInfo(`已读取 ${data.taskCount} 项任务、${data.reportCount} 篇周报、${data.documentCount} 份文档${data.usedVision ? '，并启用 VLM 阅读图片' : ''}`);
          if (data.stage === 'delta') setContent((current) => current + data.content);
          if (data.stage === 'error') throw new Error(data.error);
        }
      }
      toast.success('课题总结已生成并保存');
      await onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : '课题总结生成失败'); } finally { setGenerating(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Sparkles className="size-5 text-violet-500" />AI 课题总结</DialogTitle><p className="text-sm text-slate-500">不输入问题时默认总结当前课题情况；也可要求分析周报、阻塞风险或下一步任务。</p></DialogHeader><div className="space-y-4"><div><Label>你希望重点总结什么？（可选）</Label><Textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} placeholder="例如：分析最近四周周报，指出延期风险并提出下一步建议" /></div>{isAdmin && <div><Label>补充图片资料（可选，最多 5 张）</Label><Input type="file" accept="image/*" multiple onChange={(event) => setImages(Array.from(event.target.files || []).slice(0, 5))} /><p className="mt-1 text-[11px] text-slate-400">上传实验截图、图表或文档页面后使用 VLM；当前任务、周报和已提取文档内容会自动加入上下文。</p>{images.length > 0 && <p className="mt-1 text-xs text-violet-600">已选择：{images.map((file) => file.name).join('、')}</p>}</div>}<Button onClick={() => void generate()} disabled={generating} className="w-full bg-gradient-to-r from-violet-600 to-indigo-600">{generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{generating ? '正在统一理解课题资料…' : '生成课题总结'}</Button>{contextInfo && <p className="text-xs text-slate-500">{contextInfo}</p>}{content && <div className="max-h-[380px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-violet-100 bg-violet-50/50 p-4 text-sm leading-7 text-slate-700">{content}</div>}{!content && project.aiSummaries.length > 0 && <div><p className="mb-2 text-xs font-semibold text-slate-500">最近总结</p><div className="space-y-2">{project.aiSummaries.slice(0, 3).map((summary) => <div key={summary.id} className="rounded-xl border border-slate-100 p-3"><p className="line-clamp-2 text-sm text-slate-600">{summary.content}</p><p className="mt-1 text-[11px] text-slate-400">{summary.requestedBy.name} · {new Date(summary.createdAt).toLocaleString('zh-CN')} {summary.usedVision ? '· VLM' : '· LLM'}</p></div>)}</div></div>}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button></DialogFooter></DialogContent></Dialog>;
}

async function reviewTaskChange(projectId: string, requestId: string, decision: 'APPROVED' | 'REJECTED') { await readJson(await authFetch(`/api/projects/${projectId}/change-requests/${requestId}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })); toast.success(decision === 'APPROVED' ? '修改申请已通过' : '修改申请已驳回'); }
async function loadProjectHistory(projectId: string, setter: (items: HistoryItem[]) => void) { try { const result = await readJson<{ data: HistoryItem[] }>(await authFetch(`/api/projects/${projectId}/history?pageSize=100`)); setter(result.data); } catch (error) { toast.error(error instanceof Error ? error.message : '历史记录加载失败'); } }
async function downloadWeeklyReportAttachment(projectId: string, reportId: string, file: WeeklyReportAttachment) { try { const response = await authFetch(`/api/projects/${projectId}/weekly-reports/${reportId}/attachments/${file.id}/file`); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || '附件下载失败'); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); } catch (error) { toast.error(error instanceof Error ? error.message : '附件下载失败'); } }
async function downloadProjectDocument(projectId: string, version: ProjectDocumentVersion) { try { const response = await authFetch(`/api/projects/${projectId}/documents/${version.id}/file`); if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || '下载失败'); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = version.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url); } catch (error) { toast.error(error instanceof Error ? error.message : '下载失败'); } }
