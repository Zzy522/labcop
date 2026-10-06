"use client";
import { useState } from 'react';
import { Modal } from '@arco-design/web-react';
import { ThumbsUp, ThumbsDown, Copy, Check } from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
export function AnswerActions({runId,feedback}:{runId?:string;feedback?:string|null}) {
 const [rating,setRating]=useState(feedback);const [open,setOpen]=useState(false);const [note,setNote]=useState('');const [category,setCategory]=useState('WRONG_ANSWER');const [share,setShare]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [copied,setCopied]=useState(false);
 if(!runId)return null;
 const code=`LC-${runId}`;
 async function submit(next:'useful'|'not_useful',details=false){setBusy(true);setError('');try{const r=await authFetch('/api/assistant/feedback',{method:'POST',body:JSON.stringify({runId,rating:next,category,note:details?note:'',shareDiagnostics:details&&share})});const d=await r.json();if(!r.ok)throw new Error(d.error||'反馈失败');setRating(next);if(details)setOpen(false);}catch(e){setError(e instanceof Error?e.message:'反馈失败');}finally{setBusy(false);}}
 return <div className="mt-3 space-y-2 border-t border-slate-200/70 pt-3">
  <div className="flex flex-wrap items-center gap-2">
   <button type="button" disabled={busy} aria-pressed={rating==='useful'} onClick={()=>void submit('useful')} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-50 ${rating==='useful'?'border-teal-500 bg-teal-50 text-teal-800':'border-slate-300 bg-white text-slate-600 hover:border-teal-500'}`}><ThumbsUp className="size-4"/>{rating==='useful'?'已标记有帮助':'有帮助'}</button>
   <button type="button" disabled={busy} aria-pressed={rating==='not_useful'} onClick={()=>{void submit('not_useful');setOpen(true);}} className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-50 ${rating==='not_useful'?'border-rose-400 bg-rose-50 text-rose-700':'border-slate-300 bg-white text-slate-600 hover:border-rose-400'}`}><ThumbsDown className="size-4"/>{rating==='not_useful'?'已反馈 · 补充说明':'没帮助'}</button>
   <button type="button" title={code} onClick={()=>{void navigator.clipboard.writeText(code).then(()=>setCopied(true)).catch(()=>setError(`请手动复制问题编号：${code}`));}} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-slate-100">{copied?<Check className="size-3.5"/>:<Copy className="size-3.5"/>}{copied?'编号已复制':'复制问题编号'}</button>
  </div>
  {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}
  <Modal visible={open} title="帮助我们改进这条回答" wrapStyle={{zIndex:10050}} onCancel={()=>!busy&&setOpen(false)} onOk={()=>void submit('not_useful',true)} okText="保存补充反馈" cancelText="暂不补充" confirmLoading={busy} okButtonProps={{disabled:busy}}>
   <p className="mb-3 text-sm text-slate-500">点踩会直接记录。以下信息均为可选，关闭窗口也会保留点踩。</p>
   <label className="block text-sm">问题类型<select className="my-2 w-full rounded border p-2" value={category} onChange={e=>setCategory(e.target.value)}><option value="WRONG_ANSWER">回答不准确</option><option value="MISSING_CONTEXT">遗漏上下文或附件</option><option value="TOOL_ERROR">工具调用异常</option><option value="SLOW">响应太慢</option><option value="OTHER">其他问题</option></select></label>
   <label className="block text-sm">问题描述与期望结果<textarea className="my-2 h-24 w-full rounded border p-2" maxLength={2000} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={share} onChange={e=>setShare(e.target.checked)}/>同时向平台开发团队共享本条问答及已保留的运行诊断内容，用于排查。未采集或已过期的工具内容无法补录。</label>
   <p className="mt-4 break-all rounded bg-slate-50 p-2 text-xs text-slate-500">问题编号：{code}</p>
   {error&&<p role="alert" className="mt-2 text-red-600">{error}</p>}
  </Modal>
 </div>;
}
