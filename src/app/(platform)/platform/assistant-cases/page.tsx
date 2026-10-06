'use client';

import Link from 'next/link';
import { PlatformNav } from '@/components/platform/platform-nav';
import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth-fetch';

type CaseRow = { id: string; runId: string; category: string; status: string; createdAt: string; run: { release: string; model: string; status: string; durationMs: number | null } };
type Trace = { firstTokenMs: number | null; sessionId: string; contentAvailable: boolean; canExport: boolean; problemCode: string; id: string; release: string; harness: string; model: string; status: string; durationMs: number | null; input: string; output: string; error: string | null; interrupted: boolean; spans: Array<{ id: string; sequence: number; parentId: string | null; kind: string; name: string; status: string; durationMs: number | null; input: string; output: string | null; error: string | null }>; badCase: { owner: string; rootCause: string; id: string; category: string; note: string; status: string; expected: string; assertions: string; evaluations: Array<{ id: string; createdAt: string; candidate: string; result: string }> } | null };
const field = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900';
const action = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40';
function pretty(value: string | null) { if (!value) return ''; try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } }
async function api(url: string, init?: RequestInit) {
  const response = await authFetch(url, init); const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

export default function AssistantCasesPage() {
  const [conversation,setConversation]=useState<{question:unknown;answer:unknown;problemCode:string}[]>([]);
  const [conversationCursor,setConversationCursor]=useState<string|null>(null);
  const [conversationOpen,setConversationOpen]=useState(false);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [owner,setOwner]=useState('');const [rootCause,setRootCause]=useState('');
  const [expected, setExpected] = useState('');
  const [assertions, setAssertions] = useState('{}');
  const [status, setStatus] = useState('TRIAGED');
  const [candidate, setCandidate] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (after?: string) => {
    try { const data = await api(`/api/platform/assistant-cases${after ? `?cursor=${encodeURIComponent(after)}` : ''}`); setRows(prev => after ? [...prev, ...data.cases] : data.cases); setCursor(data.nextCursor); }
    catch (error) { setError(error instanceof Error ? error.message : '加载失败'); }
  }, []);
  useEffect(() => { void load(); const id=new URLSearchParams(window.location.search).get('run');if(id)void open(id); }, [load]);
  async function open(runId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const data: Trace = await api(`/api/platform/assistant-runs/${encodeURIComponent(runId)}`);
      setOwner(data.badCase?.owner??'');setRootCause(data.badCase?.rootCause??'');setTrace(data);setConversationOpen(false);setConversation([]); setExpected(data.badCase?.expected ?? ''); setAssertions(pretty(data.badCase?.assertions ?? '{}')); setStatus(data.badCase?.status === 'NEW' ? 'TRIAGED' : data.badCase?.status ?? 'TRIAGED'); setCandidate('');
    } catch (error) { setError(error instanceof Error ? error.message : '加载失败'); }
    finally { setBusy(false); }
  }
  async function save(evaluate = false) {
    if (!trace?.badCase) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/api/platform/assistant-cases/${trace.badCase.id}`, { method: 'PATCH', body: JSON.stringify({ owner, rootCause, expected, assertions: JSON.parse(assertions), status }) });
      if (evaluate) {
        const result = await api(`/api/platform/assistant-cases/${trace.badCase.id}`, { method: 'POST', body: JSON.stringify(JSON.parse(candidate)) });
        setNotice(`规则验证：${result.verdict}。语义正确性仍需人工复核。`);
      } else setNotice('预期行为和断言已保存。');
      const latest = await api(`/api/platform/assistant-runs/${trace.id}`); setTrace(latest); await load();
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  }
  async function markCase(){if(!trace)return;setBusy(true);try{await api('/api/platform/assistant-cases',{method:'POST',body:JSON.stringify({runId:trace.id})});await open(trace.id);await load();}catch(e){setError(e instanceof Error?e.message:'标记失败');}finally{setBusy(false);}}
  async function viewConversation(after?:string){if(!trace)return;setBusy(true);try{const d=await api(`/api/platform/assistant-sessions/${trace.sessionId}${after?`?cursor=${encodeURIComponent(after)}`:''}`);setConversation(prev=>after?[...prev,...d.messages]:d.messages);setConversationCursor(d.nextCursor);setConversationOpen(true);}catch(e){setError(e instanceof Error?e.message:'会话不可用');}finally{setBusy(false);}}
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-8">
    <div className="mx-auto max-w-7xl">
      <PlatformNav active="cases"/>
      <Link href="/platform" className="text-sm text-teal-700">← 平台控制台</Link>
      <h1 className="mt-4 text-2xl font-semibold">运行诊断与 Bad case</h1>
      <p className="my-3 text-sm text-slate-600">按开发者授权范围查看记录。完整内容仅限测试采集或明确共享且未过期的记录，查看与导出均记录审计。</p>
      {error && <p role="alert" className="my-3 rounded bg-red-50 p-3 text-red-700">{error}</p>}
      {notice && <p role="status" className="my-3 rounded bg-teal-50 p-3 text-teal-800">{notice}</p>}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-3"><button className={action} disabled={busy} onClick={() => void load()}>刷新案例</button>
          {!rows.length && <p className="text-sm text-slate-500">暂无反馈案例</p>}
          {rows.map(row => <button key={row.id} disabled={busy} onClick={() => void open(row.runId)} className={`block w-full rounded-xl border p-3 text-left text-sm ${trace?.id === row.runId ? 'border-teal-500 bg-teal-50' : 'border-slate-200 bg-white'}`}>
            <strong>{row.category} · {row.status}</strong><p className="mt-1 break-all text-xs">{row.run.release}</p><p className="mt-1 text-xs text-slate-500">{row.run.status} · {row.run.durationMs ?? '?'} ms · {new Date(row.createdAt).toLocaleString()}</p>
          </button>)}
          {cursor && <button className={action} onClick={() => void load(cursor)}>加载更多</button>}
        </aside>
        {trace && <article className="min-w-0 space-y-5 rounded-xl border bg-white p-5">
          <div><h2 className="text-lg font-semibold">运行详情</h2><p className="break-all text-xs text-slate-500">问题编号 {trace.problemCode}</p><p className="mt-2 text-sm">{trace.release} · Harness {trace.harness} · {trace.model} · {trace.status} · {trace.durationMs ?? '?'} ms · 首字 {trace.firstTokenMs ?? '未知'} ms</p>
            {trace.interrupted && <p className="text-amber-700">运行未正常结束，可能发生进程中断；请结合服务日志排查。</p>}
            {trace.canExport && <a className="mt-2 inline-block text-sm text-teal-700" href={`/api/platform/assistant-runs/${trace.id}?download=1`}>下载 Trace / 案例 JSON</a>}
          </div>
          {!trace.contentAvailable&&<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">该运行仅提供指标：未采集、未共享、已过期，或当前账号没有正文权限。不能补录历史工具内容。</p>}
          <div className="flex flex-wrap gap-2"><button className={action} disabled={busy} onClick={()=>void viewConversation()}>查看对应会话</button>{!trace.badCase&&<button className={action} disabled={busy} onClick={()=>void markCase()}>标记为 Bad case</button>}</div>
          {conversationOpen&&<section className="rounded-xl border p-4"><h3 className="font-medium">已授权采集的对话轮次</h3><p className="my-2 text-xs text-slate-500">仅显示保留期内的采集或共享轮次；未采集历史不会补录。</p>{trace.canExport&&<a className="text-sm text-teal-700" href={`/api/platform/assistant-sessions/${trace.sessionId}?download=1`}>导出会话首页（最多 50 轮）</a>}{conversation.map((m,i)=><div key={i} className="my-3 space-y-2 rounded-lg bg-slate-50 p-3"><p className="break-all text-xs text-slate-400">{m.problemCode}</p><p className="whitespace-pre-wrap text-sm"><strong>用户：</strong>{typeof m.question==='string'?m.question:JSON.stringify(m.question)}</p><p className="whitespace-pre-wrap text-sm"><strong>助手：</strong>{typeof m.answer==='string'?m.answer:JSON.stringify(m.answer)}</p></div>)}{conversationCursor&&<button className={action} onClick={()=>void viewConversation(conversationCursor)}>加载后续轮次</button>}</section>}
          {trace.badCase&&<p className="whitespace-pre-wrap rounded-lg bg-amber-50 p-3 text-sm">用户或团队反馈：{trace.badCase.note || '未填写补充说明'}</p>}
          <details><summary className="cursor-pointer font-medium">实际输入范围与上下文快照</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-3 text-xs">{pretty(trace.input)}</pre></details>
          <details><summary className="cursor-pointer font-medium">回答与错误</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{pretty(trace.output)}{trace.error && `\nERROR: ${pretty(trace.error)}`}</pre></details>
          <section><h3 className="font-medium">执行时间线</h3>{trace.spans.map(span => <details key={span.id} className={`mt-2 rounded border p-2 text-sm ${span.parentId ? 'ml-4 border-l-teal-300' : ''}`}><summary className="cursor-pointer">{span.sequence}. {span.kind} / {span.name} · {span.status} · {span.durationMs ?? '?'} ms</summary><pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">输入：{pretty(span.input)}{'\n'}输出：{pretty(span.output)}{'\n'}错误：{pretty(span.error)}</pre></details>)}</section>
          {trace.badCase && <><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">负责人<input className={field} value={owner} maxLength={100} onChange={e=>setOwner(e.target.value)} placeholder="填写团队负责人"/></label><label className="text-sm">原因分析<input className={field} value={rootCause} maxLength={2000} onChange={e=>setRootCause(e.target.value)} placeholder="如工具参数错误、检索遗漏"/></label></div><label className="block text-sm font-medium">预期行为与人工验收标准<textarea className={`${field} mt-2 h-24`} value={expected} onChange={e => setExpected(e.target.value)} maxLength={10000} /></label>
          <label className="block text-sm font-medium">可执行断言 JSON<textarea spellCheck={false} className={`${field} mt-2 h-36 font-mono`} value={assertions} onChange={e => setAssertions(e.target.value)} placeholder={'{"contains":["预期关键词"],"excludes":[],"requiredTools":[],"forbiddenTools":[],"maxDurationMs":60000}'} /></label>
          <p className="text-xs text-slate-500">支持 contains、excludes、requiredTools、forbiddenTools 数组和 maxDurationMs 数值。未设置任何规则时仅标记 NEEDS_REVIEW。</p>
          <div className="flex gap-3"><select aria-label="案例状态" className="rounded border p-2" value={status} onChange={e => setStatus(e.target.value)}><option value="TRIAGED">已分诊</option><option value="READY">可回归</option><option value="CLOSED">已关闭</option></select><button className={action} disabled={busy} onClick={() => void save()}>保存案例</button></div>
          <label className="block text-sm font-medium">新版本运行结果 JSON<textarea spellCheck={false} className={`${field} mt-2 h-36 font-mono`} value={candidate} onChange={e => setCandidate(e.target.value)} placeholder={'{"release":"新版本提交号","output":"新回答","tools":["工具名"],"durationMs":1500,"status":"OK"}'} /></label>
          <p className="text-xs text-slate-500">在相同输入和授权范围下重新运行后填入结果。此处执行规则校验，不自动调用模型、不访问原实验室数据；模型语义正确性由团队复核。</p>
          <button className={action} disabled={busy || !candidate.trim()} onClick={() => void save(true)}>保存并验证新结果</button>
          <section><h3 className="font-medium">最近验证记录</h3>{trace.badCase.evaluations.map(item => <details className="mt-2 rounded border p-2 text-sm" key={item.id}><summary>{new Date(item.createdAt).toLocaleString()} · {JSON.parse(item.result).verdict}</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{pretty(item.result)}{'\n'}候选结果：{pretty(item.candidate)}</pre></details>)}</section>
          </>}
        </article>}
      </div>
    </div>
  </main>;
}
