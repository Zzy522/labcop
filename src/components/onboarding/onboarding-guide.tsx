'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { BookOpenCheck, Check, ChevronLeft, ChevronRight, GraduationCap, MapPinned, Sparkles, X } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export const OPEN_ONBOARDING_EVENT = 'lab-cop:open-onboarding';
const GUIDE_VERSION = 1;

type GuideRole = 'admin' | 'member';
type GuideStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'DISMISSED';

interface ProgressItem {
  guideKey: string;
  guideVersion: number;
  status: GuideStatus;
  lastStep: number;
  doNotAutoPrompt: boolean;
}

interface GuideStep {
  target: string;
  title: string;
  description: string;
  action: string;
  result: string;
}

interface GuideDefinition {
  key: string;
  title: string;
  description: string;
  route: string;
  steps: GuideStep[];
}

const adminQuickSteps: GuideStep[] = [
  { target: '[data-tour="page-content"]', title: '从管理总览开始', description: '这里集中展示待审批事项、风险和今日处理结果。', action: '每天先看橙色和红色提醒。', result: '处理后统计卡和审批动态会立即变化。' },
  { target: '[data-tour="admin-research-nav"]', title: '查看科研整体进展', description: '科研总览聚合课题、化合物、阶段任务和科研审批。', action: '需要科研态势时从这里进入。', result: '你仍停留在当前页面，不会被自动跳转。' },
  { target: '[data-tour="admin-reagents-nav"]', title: '管理试剂与原始票据', description: '试剂总览提供库存、安全资料和可追溯票据库。', action: '优先关注高风险、临期和低库存记录。', result: '票据原件、上传人和入库状态可统一筛选。' },
  { target: '[data-tour="admin-management-group"]', title: '展开管理相关', description: '设备、审批、巡检、资质、报表和规则集中在此分组。', action: '按当前事务进入对应模块。', result: '首轮只指出入口，不会替你打开或提交页面。' },
  { target: '[data-tour="admin-assistant-nav"]', title: '选择科研助手或管理助手', description: '科研助手总结课题，管理助手分析审批、安全和资源。', action: '首次使用前查看 LLM、VLM、OCR 配置状态。', result: '未配置时会给出明确入口，不会错误声称不支持图片。' },
];

const memberQuickSteps: GuideStep[] = [
  { target: '[data-tour="page-content"]', title: '从个人工作台开始', description: '首页只展示与你相关的申请、预约、课题任务和通知。', action: '先处理数字不为零的待办。', result: '成为课题管理员后会自动增加科研审批区域。' },
  { target: '[data-tour="member-reagents-nav"]', title: '查询试剂并完成入库', description: '试剂入库支持 OCR、手工填写并归档票据，以及遗漏票据补录。', action: '采购入库时同步保存原始票据。', result: '选择不识别时不会调用 OCR，也不会重复增加库存。' },
  { target: '[data-tour="member-equipment-nav"]', title: '预约设备', description: '查看设备状态、资质要求和可用时段后提交预约。', action: '时间变化时及时调整预约。', result: '预约结果会进入个人首页和通知。' },
  { target: '[data-tour="member-knowledge-nav"]', title: '参与科研课题', description: '查看课题、阶段任务、文档和历史；普通成员通过申请修改任务。', action: '课题管理员可直接维护并处理科研审批。', result: '所有修改都有版本号和追加式历史。' },
  { target: '[data-tour="member-assistant-nav"]', title: '使用双模式 AI 助手', description: '科研助手处理课题与科研数据，管理助手处理个人事务和安全问题。', action: '上传图片会使用当前模式对应的 VLM 提示词。', result: '实验室已有统一配置时无需重复填写个人 Key。' },
];

function moduleGuides(role: GuideRole): GuideDefinition[] {
  const pageStep = (title: string, description: string, action: string, result: string): GuideStep[] => [
    { target: '[data-tour="page-content"]', title, description, action, result },
  ];
  return role === 'admin'
    ? [
        { key: 'MODULE_MANAGEMENT', title: '管理总览', description: '审批、风险与今日事项', route: '/admin', steps: pageStep('读懂管理总览', '从审批分类进入真实处理页面，安全卡用于判断优先级。', '切换审批分类查看不同事项。', '处理完成后统计与动态同步刷新。') },
        { key: 'MODULE_RESEARCH', title: '科研总览', description: '课题、化合物与科研审批', route: '/admin/research', steps: pageStep('读懂科研总览', '近期更新课题按真实更新时间排序，统计来自课题与化合物知识库。', '从课题卡进入知识库继续处理。', '不会在总览中复制或覆盖课题业务数据。') },
        { key: 'MODULE_REAGENTS', title: '试剂与票据', description: '库存、风险和原始票据', route: '/admin/reagents', steps: pageStep('管理试剂与票据', '票据库可按日期、上传人、试剂属性和处理方式筛选。', '先核对高风险和待确认票据。', '原件可查看和批量下载。') },
        { key: 'MODULE_KNOWLEDGE', title: '课题知识库', description: '权限、任务、文档与版本', route: '/admin/knowledge', steps: pageStep('管理科研课题', '每个课题必须有 1～3 名实验员课题管理员。', '从课题详情维护任务、文档和成员。', '旧版本与修改记录始终保留。') },
        { key: 'MODULE_ASSISTANT', title: 'AI 助手与 API', description: '双 Agent 和模型配置', route: '/admin/assistant', steps: pageStep('配置并使用双模式助手', '管理助手和科研助手使用独立提示词、工具和状态机。', '先检查 LLM、VLM、OCR 状态，再选择助手模式。', '模式切换会建立新会话，避免上下文污染。') },
      ]
    : [
        { key: 'MODULE_STOCK_IN', title: '试剂与票据入库', description: 'OCR、手工归档和补录', route: '/user/upload', steps: pageStep('选择正确的入库方式', '智能识别调用 OCR；手工归档和补录票据不会调用 OCR。', '普通采购入库请同时拍摄票据。', '票据与具体入库台账建立关联。') },
        { key: 'MODULE_EQUIPMENT', title: '设备预约', description: '状态、资质和时间', route: '/user/equipment-apply', steps: pageStep('完成设备预约', '系统会检查设备状态、时间冲突和必要资质。', '填写用途并选择真实使用时段。', '审批或状态变化会进入个人通知。') },
        { key: 'MODULE_KNOWLEDGE', title: '课题知识库', description: '任务、文档和修改申请', route: '/user/knowledge', steps: pageStep('参与课题协作', '普通成员申请修改阶段任务，课题管理员可直接维护。', '先确认自己的课题角色。', '所有操作都会形成可追溯版本。') },
        { key: 'MODULE_ASSISTANT', title: 'AI 助手与 API', description: '科研/管理模式和图片理解', route: '/user/assistant', steps: pageStep('选择助手模式', '科研助手可总结课题，管理助手处理个人事务和安全咨询。', '上传图片前确认 VLM 已配置。', '缺少配置时会提供明确入口。') },
      ];
}

async function saveProgress(payload: Record<string, unknown>): Promise<ProgressItem | null> {
  const response = await authFetch('/api/onboarding', { method: 'POST', body: JSON.stringify(payload) });
  if (!response.ok) return null;
  const body = await response.json();
  return body.data as ProgressItem;
}

export function OnboardingLauncher({ compact = false }: { compact?: boolean }) {
  return <Button type="button" variant="ghost" size={compact ? 'icon' : 'sm'} aria-label="打开新手指引" data-tour="onboarding-launcher" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_ONBOARDING_EVENT))}><GraduationCap className="size-4" />{!compact && <span>新手指引</span>}</Button>;
}

export function OnboardingGuide({ role }: { role: GuideRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const quickKey = role === 'admin' ? 'ADMIN_QUICK' : 'MEMBER_QUICK';
  const quickSteps = role === 'admin' ? adminQuickSteps : memberQuickSteps;
  const guides = useMemo(() => moduleGuides(role), [role]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [centerOpen, setCenterOpen] = useState(false);
  const [doNotAutoPrompt, setDoNotAutoPrompt] = useState(false);
  const [activeGuide, setActiveGuide] = useState<GuideDefinition | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [pendingGuide, setPendingGuide] = useState<GuideDefinition | null>(null);
  const autoCheckedRef = useRef(false);

  const quickGuide = useMemo<GuideDefinition>(() => ({ key: quickKey, title: role === 'admin' ? '管理员首次快速引导' : '实验员首次快速引导', description: '约 60 秒认识最重要的入口', route: role === 'admin' ? '/admin' : '/user', steps: quickSteps }), [quickKey, quickSteps, role]);

  useEffect(() => {
    let cancelled = false;
    authFetch('/api/onboarding').then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      if (!cancelled) setProgress(Array.isArray(body.data) ? body.data : []);
    }).finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const open = () => setCenterOpen(true);
    window.addEventListener(OPEN_ONBOARDING_EVENT, open);
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, open);
  }, []);

  useEffect(() => {
    if (!loaded || autoCheckedRef.current || pathname !== quickGuide.route) return;
    autoCheckedRef.current = true;
    const item = progress.find((value) => value.guideKey === quickKey && value.guideVersion === GUIDE_VERSION);
    if (!item || ((item.status === 'NOT_STARTED' || item.status === 'IN_PROGRESS' || item.status === 'DISMISSED') && !item.doNotAutoPrompt)) setWelcomeOpen(true);
  }, [loaded, pathname, progress, quickGuide.route, quickKey]);

  const beginGuide = useCallback(async (guide: GuideDefinition, restart = false) => {
    setCenterOpen(false);
    setWelcomeOpen(false);
    setPendingGuide(null);
    setActiveGuide(guide);
    setStepIndex(0);
    const saved = await saveProgress({ guideKey: guide.key, guideVersion: GUIDE_VERSION, action: restart ? 'RESTART' : 'START', lastStep: 0 });
    if (saved) setProgress((current) => [...current.filter((item) => !(item.guideKey === saved.guideKey && item.guideVersion === saved.guideVersion)), saved]);
  }, []);

  const requestGuide = useCallback((guide: GuideDefinition) => {
    if (pathname === guide.route) void beginGuide(guide, true);
    else { setCenterOpen(false); setPendingGuide(guide); router.push(guide.route); }
  }, [beginGuide, pathname, router]);

  useEffect(() => {
    if (pendingGuide && pathname === pendingGuide.route) void beginGuide(pendingGuide, true);
  }, [beginGuide, pathname, pendingGuide]);

  useEffect(() => {
    if (!activeGuide) { setTargetRect(null); return; }
    const update = () => {
      const selector = activeGuide.steps[stepIndex]?.target;
      const element = selector ? document.querySelector(selector) : null;
      if (!element) { setTargetRect(null); return; }
      const rect = element.getBoundingClientRect();
      if (rect.top < 8 || rect.bottom > window.innerHeight - 8) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTargetRect(element.getBoundingClientRect());
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
  }, [activeGuide, stepIndex]);

  const closeGuide = useCallback(() => { setActiveGuide(null); setTargetRect(null); }, []);
  const finishGuide = useCallback(async () => {
    if (!activeGuide) return;
    const saved = await saveProgress({ guideKey: activeGuide.key, guideVersion: GUIDE_VERSION, action: 'COMPLETE', lastStep: activeGuide.steps.length - 1 });
    if (saved) setProgress((current) => [...current.filter((item) => item.guideKey !== saved.guideKey), saved]);
    closeGuide();
    setCenterOpen(true);
  }, [activeGuide, closeGuide]);

  const nextStep = useCallback(() => {
    if (!activeGuide) return;
    if (stepIndex >= activeGuide.steps.length - 1) { void finishGuide(); return; }
    const next = stepIndex + 1;
    setStepIndex(next);
    void saveProgress({ guideKey: activeGuide.key, guideVersion: GUIDE_VERSION, action: 'PROGRESS', lastStep: next });
  }, [activeGuide, finishGuide, stepIndex]);

  const dismissWelcome = useCallback(async () => {
    const saved = await saveProgress({ guideKey: quickKey, guideVersion: GUIDE_VERSION, action: 'DISMISS', lastStep: 0, doNotAutoPrompt });
    if (saved) setProgress((current) => [...current.filter((item) => item.guideKey !== quickKey), saved]);
    setWelcomeOpen(false);
  }, [doNotAutoPrompt, quickKey]);

  const activeStep = activeGuide?.steps[stepIndex];
  const panelStyle = targetRect
    ? { left: Math.min(Math.max(16, targetRect.left), window.innerWidth - 396), top: Math.min(window.innerHeight - 330, Math.max(16, targetRect.bottom + 18)) }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  return <>
    <Dialog open={welcomeOpen} onOpenChange={(open) => !open && void dismissWelcome()}><DialogContent className="max-w-lg"><DialogHeader><div className={cn('mb-3 flex size-12 items-center justify-center rounded-2xl text-white', role === 'admin' ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-gradient-to-br from-emerald-500 to-teal-600')}><Sparkles className="size-6" /></div><DialogTitle>{role === 'admin' ? '欢迎使用 Lab Copilot 管理控制台' : '欢迎使用 Lab Copilot 实验员工作台'}</DialogTitle><p className="text-sm leading-6 text-slate-500">用约 60 秒认识最重要的入口。引导只高亮和说明，不会审批、删除或提交任何业务数据。</p></DialogHeader><label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><input type="checkbox" className="mt-0.5" checked={doNotAutoPrompt} onChange={(event) => setDoNotAutoPrompt(event.target.checked)} /><span><strong className="text-slate-800">不再自动提示</strong><br />仍可从顶部“新手指引”随时重新播放。</span></label><DialogFooter><Button variant="outline" onClick={() => void dismissWelcome()}>稍后再说</Button><Button onClick={() => void beginGuide(quickGuide, true)}>开始快速引导</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={centerOpen} onOpenChange={setCenterOpen}><DialogContent className="max-w-2xl"><DialogHeader><div className="flex items-center justify-between"><DialogTitle className="flex items-center gap-2"><GraduationCap className="size-5 text-violet-600" />新手指引</DialogTitle><button type="button" aria-label="关闭" onClick={() => setCenterOpen(false)} className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"><X className="size-5" /></button></div><p className="text-sm text-slate-500">快速引导不会自动换页；模块深度引导仅在你主动选择后进入对应页面。</p></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><GuideCard guide={quickGuide} progress={progress} onStart={() => requestGuide(quickGuide)} primary />{guides.map((guide) => <GuideCard key={guide.key} guide={guide} progress={progress} onStart={() => requestGuide(guide)} />)}</div></DialogContent></Dialog>

    {activeGuide && activeStep && <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={activeGuide.title}>
      {targetRect ? <div className="pointer-events-none fixed rounded-2xl border-2 border-cyan-300 bg-transparent shadow-[0_0_0_9999px_rgba(2,12,27,0.72),0_0_0_5px_rgba(34,211,238,0.18)] transition-all duration-200" style={{ left: targetRect.left - 8, top: targetRect.top - 8, width: targetRect.width + 16, height: targetRect.height + 16 }}><span className="absolute -right-2 -top-2 size-4 animate-ping rounded-full bg-cyan-300" /></div> : <div className="pointer-events-none fixed inset-0 bg-slate-950/70" />}
      <Card className="fixed z-[101] w-[380px] max-w-[calc(100vw-32px)] border-cyan-200 shadow-2xl" style={panelStyle}><CardContent className="space-y-4 p-5"><div className="flex items-start gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700"><MapPinned className="size-5" /></div><div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wider text-cyan-600">{activeGuide.title} · 第 {stepIndex + 1}/{activeGuide.steps.length} 步</p><h2 className="mt-1 font-bold text-slate-900">{activeStep.title}</h2></div><button type="button" aria-label="退出引导" onClick={closeGuide}><X className="size-5 text-slate-400" /></button></div><p className="text-sm leading-6 text-slate-600">{activeStep.description}</p><div className="space-y-2 rounded-xl bg-slate-50 p-3 text-xs leading-5"><p><strong className="text-slate-700">现在可以做：</strong>{activeStep.action}</p><p><strong className="text-slate-700">你会看到：</strong>{activeStep.result}</p>{!targetRect && <p className="text-amber-600">当前目标在此页面暂不可见，你可以继续下一步，不会卡住。</p>}</div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-all" style={{ width: `${((stepIndex + 1) / activeGuide.steps.length) * 100}%` }} /></div><div className="flex items-center justify-between"><Button variant="ghost" size="sm" disabled={stepIndex === 0} onClick={() => setStepIndex((value) => Math.max(0, value - 1))}><ChevronLeft className="size-4" />上一步</Button><Button size="sm" onClick={nextStep}>{stepIndex === activeGuide.steps.length - 1 ? <><Check className="size-4" />完成</> : <>下一步<ChevronRight className="size-4" /></>}</Button></div></CardContent></Card>
    </div>}
  </>;
}

function GuideCard({ guide, progress, onStart, primary = false }: { guide: GuideDefinition; progress: ProgressItem[]; onStart: () => void; primary?: boolean }) {
  const item = progress.find((value) => value.guideKey === guide.key && value.guideVersion === GUIDE_VERSION);
  const completed = item?.status === 'COMPLETED';
  return <button type="button" onClick={onStart} className={cn('rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md', primary ? 'border-violet-200 bg-gradient-to-br from-violet-50 to-cyan-50' : 'border-slate-200 bg-white')}><div className="flex items-start gap-3"><div className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl', completed ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-600')}>{completed ? <Check className="size-5" /> : <BookOpenCheck className="size-5" />}</div><div><p className="font-semibold text-slate-800">{guide.title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{guide.description}</p><p className={cn('mt-2 text-xs font-medium', completed ? 'text-emerald-600' : 'text-violet-600')}>{completed ? '已完成 · 可重新播放' : '开始指引'}</p></div></div></button>;
}
