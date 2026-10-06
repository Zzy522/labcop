'use client';

import { useSessionProgress, visibleMessage, isGenerating } from './use-session-progress';
import { MoleculeInput } from '@/components/assistant/molecule-input';
import { DiagnosticNotice } from '@/components/assistant/diagnostic-notice';
import { AnswerActions } from '@/components/assistant/answer-actions';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bot, Send, Loader2, Plus, Trash2, MessageSquare, ImagePlus, X, Sparkles, Settings2, FlaskConical, ShieldCheck, Square, UploadCloud, FileImage,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/auth-fetch';
import { toast } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth-store';
import { AssistantMessageContent } from '@/components/assistant/assistant-message-content';

interface ChatMessage {
  runId?: string;
  feedback?: string | null;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  images?: UploadedImage[];
}

interface SessionItem {
  id: string;
  title: string;
  role: string;
  assistantMode: AssistantMode;
  lastActiveAt: string;
  _count: { messages: number };
}

type AssistantMode = 'RESEARCH' | 'MANAGEMENT';

const RESEARCH_QUICK_QUESTIONS = [
  { icon: FlaskConical, text: '总结我参与课题的近期进展', desc: '阶段任务、阻塞项与下一步' },
  { icon: Sparkles, text: '近期哪些课题数据有更新？', desc: '查看最近更新的科研数据' },
  { icon: MessageSquare, text: '梳理课题阶段任务和风险', desc: '形成可执行的研究建议' },
];

interface UploadedImage {
  name: string;
  dataUrl: string;
}

interface AssistantWorkspaceProps {
  role: 'admin' | 'user';
  /** 快捷问题（按角色定制） */
  quickQuestions: Array<{ icon: React.ElementType; text: string; desc?: string }>;
  /** API 配置页路径 */
  apiConfigPath: string;
  /** 主题色（admin=indigo / user=teal） */
  accent: 'indigo' | 'teal';
}

/**
 * 统一助手工作台：侧边栏会话记忆 + SSE 流式对话 + 图片上传（VLM 图片理解）。
 * admin / user 复用，差异在 role、快捷问题、主题色。
 */
export function AssistantWorkspace({ role, quickQuestions, apiConfigPath, accent }: AssistantWorkspaceProps) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [attachments, setAttachments] = useState<Array<{ id: string; name: string; warning: string }>>([]);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const documentUploadLock = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>(role === 'admin' ? 'MANAGEMENT' : 'RESEARCH');
  const [agentStage, setAgentStage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const viewRevision = useRef(0);
  const [progressRevision, setProgressRevision] = useState(0);
  useSessionProgress(activeSessionId, progressRevision, items => {
    setMessages(items.map(visibleMessage));
    setIsTyping(items.some(isGenerating));
    setAgentStage(items.some(isGenerating) ? '正在后台生成，可切换页面或会话…' : '');
  });

  const accentText = accent === 'indigo' ? 'text-indigo-600' : 'text-teal-600';
  const accentBg = accent === 'indigo' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-teal-600 hover:bg-teal-700';
  const userBubble = accent === 'indigo' ? 'bg-indigo-600' : 'bg-teal-600';
  const modeStorageKey = `lab-cop:assistant-mode:${role}`;
  const displayedQuickQuestions = assistantMode === 'RESEARCH' ? RESEARCH_QUICK_QUESTIONS : quickQuestions;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(modeStorageKey);
      if (saved === 'RESEARCH' || saved === 'MANAGEMENT') setAssistantMode(saved);
    } catch {
      // localStorage 不可用时使用角色默认值
    }
  }, [modeStorageKey]);

  // ─── 加载会话列表 ───
  const loadSessions = useCallback(async () => {
    try {
      const res = await authFetch(`/api/assistant/sessions?pageSize=30&assistantMode=${assistantMode}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[assistant] 加载会话列表失败:', res.status, data);
        setSessions([]);
        return;
      }
      // 兼容 paginatedResponse { data, pagination } 结构
      const list = data?.data?.data ?? data?.data ?? [];
      setSessions(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error('[assistant] 加载会话列表异常:', e);
    }
  }, [assistantMode]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ─── 加载指定会话消息 ───
  const loadSession = useCallback(async (sessionId: string) => {
    if (loadingSessionId) return; // 防重复点击
    const revision = ++viewRevision.current;
    setLoadingSessionId(sessionId);
    try {
      const res = await authFetch(`/api/assistant/sessions/${sessionId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[assistant] 加载会话失败:', res.status, data);
        toast.error(data?.error || `加载会话失败（${res.status}），请稍后重试`);
        return;
      }
      if (revision !== viewRevision.current) return;
      if (Array.isArray(data?.messages)) {
        if (data?.session?.assistantMode && data.session.assistantMode !== assistantMode) {
          toast.error('该会话属于另一助手模式，请先切换助手');
          return;
        }
        setMessages(data.messages.map(visibleMessage));
        setIsTyping(data.messages.some(isGenerating));
        setActiveSessionId(sessionId);
        setProgressRevision(n => n + 1);
        localStorage.setItem(`lab-safety:chat-session:${role}:${assistantMode}`, sessionId);
      } else {
        console.warn('[assistant] 会话响应缺少 messages 字段:', data);
        toast.error('会话数据异常，请刷新后重试');
      }
    } catch (e) {
      console.error('[assistant] 加载会话异常:', e);
      toast.error('网络异常，加载会话失败');
    } finally {
      setLoadingSessionId(null);
    }
  }, [loadingSessionId, assistantMode, role]);

  // ─── 新建会话 ───
  const newSession = useCallback(() => {
    ++viewRevision.current;
    setIsTyping(false);
    setAgentStage('');
    localStorage.removeItem(`lab-safety:chat-session:${role}:${assistantMode}`);
    setActiveSessionId(null);
    setMessages([]);
    setImages([]);
    setInput('');
  }, [role, assistantMode]);

  const switchAssistantMode = useCallback((nextMode: AssistantMode) => {
    if (nextMode === assistantMode) return;
    ++viewRevision.current;
    setIsTyping(false);
    setAssistantMode(nextMode);
    setActiveSessionId(null);
    setMessages([]);
    setImages([]);
    setInput('');
    setAgentStage('');
    try {
      localStorage.setItem(modeStorageKey, nextMode);
    } catch {
      // ignore
    }
  }, [assistantMode, modeStorageKey]);

  // ─── 删除会话 ───
  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await authFetch(`/api/assistant/sessions?id=${sessionId}`, { method: 'DELETE' });
      if (activeSessionId === sessionId) newSession();
      loadSessions();
    } catch {
      /* ignore */
    }
  }, [activeSessionId, newSession, loadSessions]);

  // ─── 滚动到底部 ───
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  // ─── 图片选择（点击 + 拖拽） ───
  const [isDragOver, setIsDragOver] = useState(false);

  const processFiles = useCallback(async (files: File[]) => {
    if (isTyping || documentUploadLock.current) return;
    const documents = files.filter(file => !file.type.startsWith('image/'));
    if (documents.length) {
      documentUploadLock.current = true;
      setUploadingDocument(true);
      try {
        if (documents.length + attachments.length > 3) throw new Error('每次最多选择 3 个文档');
        for (const file of documents) {
          if (file.size > 10 * 1024 * 1024) throw new Error('单个文档不能超过 10MB');
          const form = new FormData(); form.append('file', file);
          const response = await authFetch('/api/assistant/attachments', { method: 'POST', body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '文档解析失败');
          setAttachments(previous => [...previous, result.data]);
        }
      } catch (error) { toast.error(error instanceof Error ? error.message : '文档上传失败'); }
      finally { setUploadingDocument(false); documentUploadLock.current = false; }
    }
    const accepted = files.filter((file) => file.type.startsWith('image/') && file.size <= 5 * 1024 * 1024);
    if (accepted.length === 0) return;
    const dataUrls = await Promise.all(accepted.map((file) => new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target?.result as string);
      reader.readAsDataURL(file);
    })));
    const newImages = dataUrls.map((dataUrl, i) => ({ name: accepted[i].name, dataUrl }));
    setImages((prev) => {
      if (prev.length >= 5) return prev;
      const room = Math.max(0, 5 - prev.length);
      return [...prev, ...newImages.slice(0, room)];
    });
  }, [isTyping, attachments.length]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    void processFiles(Array.from(files));
    e.target.value = '';
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void processFiles(Array.from(e.dataTransfer.files));
    }
  }, [processFiles]);

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ─── 发送消息 ───
  const handleSend = useCallback(async (text?: string) => {
    const hasImages = images.length > 0;
    const rawQuestion = (text ?? input).trim();
    if ((!rawQuestion && !hasImages && attachments.length === 0) || isTyping || uploadingDocument) return;
    const question = rawQuestion || '请分析上传的资料，说明读取范围与主要内容。';
    const sendingImages = hasImages ? [...images] : [];
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: (hasImages ? `${question}\n[附带 ${images.length} 张图片]` : question) + (attachments.length ? `\n[附件：${attachments.map(file => file.name).join('、')}]` : ''),
      timestamp: new Date(),
      images: sendingImages,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setImages([]);
    setIsTyping(true);
    setAgentStage(hasImages ? '正在上传并校验图片…' : '正在路由到助手…');

    const assistantId = `a-${Date.now()}`;
    // 文本、工具和图片统一进入智能体 SSE 路由，由服务端按意图选择 LLM / 工具 / VLM。
    setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', timestamp: new Date(), isStreaming: true }]);
    const revision = viewRevision.current;
    try {
      const res = await authFetch('/api/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ background: true, messages: [{ role: 'user', content: question }], role, assistantMode,
          sessionId: activeSessionId ?? undefined, images: sendingImages, attachmentIds: attachments.map(file => file.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '提交失败');
      localStorage.setItem(`lab-safety:chat-session:${role}:${assistantMode}`, data.sessionId);
      void loadSessions();
      if (revision !== viewRevision.current) return;
      setAttachments([]);
      setActiveSessionId(data.sessionId);
      setProgressRevision(n => n + 1);
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, id: data.messageId, runId: data.runId } : m));
      setAgentStage('正在后台生成，可切换页面或会话…');
    } catch (error) {
      if (revision !== viewRevision.current) return;
      setIsTyping(false);
      setAgentStage('');
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, isStreaming: false, content: error instanceof Error ? error.message : '提交失败，请检查会话记录后重试' } : m));
    }
  }, [input, isTyping, images, attachments, uploadingDocument, role, assistantMode, activeSessionId, loadSessions]);

  const stopGeneration = useCallback(async () => {
    const runId = messages.find(m => m.isStreaming)?.runId;
    if (!runId) return;
    try {
      const response = await authFetch(`/api/assistant/generations/${runId}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error('停止失败，请重试');
      setAgentStage('正在停止…');
    } catch { toast.error('停止失败，请重试'); }
  }, [messages]);

  useEffect(() => {
    const saved = localStorage.getItem(`lab-safety:chat-session:${role}:${assistantMode}`);
    ++viewRevision.current;
    setMessages([]); setIsTyping(false); setAgentStage('');
    setActiveSessionId(saved || null);
    setProgressRevision(n => n + 1);
  }, [role, assistantMode]);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-w-0 flex-col gap-4 md:flex-row">
      {/* ─── 侧边栏：会话记忆 ─── */}
      <aside className={cn('flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm transition-all', sidebarOpen ? 'max-h-44 w-full shrink-0 md:max-h-none md:w-64' : 'hidden')}>
        <div className="flex items-center justify-between border-b border-gray-100 p-3">
          <span className="text-sm font-semibold text-gray-700">对话记录</span>
          <Button variant="ghost" size="sm" onClick={newSession} className="h-7 px-2 text-xs">
            <Plus className="size-4" /> 新会话
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-gray-400">暂无历史会话</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => loadSession(s.id)}
                className={cn(
                  'group mb-1 flex cursor-pointer items-start gap-2 rounded-lg p-2 text-sm transition-colors',
                  activeSessionId === s.id ? 'bg-gray-100' : 'hover:bg-gray-50'
                )}
              >
                {loadingSessionId === s.id ? (
                  <Loader2 className={cn('mt-0.5 size-4 shrink-0 animate-spin', accentText)} />
                ) : (
                  <MessageSquare className={cn('mt-0.5 size-4 shrink-0', accentText)} />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-gray-800">{s.title || '未命名会话'}</p>
                  <p className="text-xs text-gray-400">{new Date(s.lastActiveAt).toLocaleDateString('zh-CN')} · {s._count.messages}条</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="hidden shrink-0 text-gray-300 hover:text-red-500 group-hover:block"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* ─── 主聊天区 ─── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
          <div className="flex rounded-lg bg-gray-100 p-1" aria-label="切换助手模式">
            <button
              type="button"
              onClick={() => switchAssistantMode('RESEARCH')}
              className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition', assistantMode === 'RESEARCH' ? 'bg-white text-violet-700 shadow-sm' : 'text-gray-500 hover:text-gray-800')}
            >
              <FlaskConical className="size-3.5" />科研助手
            </button>
            <button
              type="button"
              onClick={() => switchAssistantMode('MANAGEMENT')}
              className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition', assistantMode === 'MANAGEMENT' ? 'bg-white text-sky-700 shadow-sm' : 'text-gray-500 hover:text-gray-800')}
            >
              <ShieldCheck className="size-3.5" />管理助手
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen((v) => !v)} className="h-8 px-2 text-xs text-gray-500">
              {sidebarOpen ? '收起' : '记录'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push(apiConfigPath)} className="h-8 text-xs">
              <Settings2 className="size-4" /> API 配置
            </Button>
          </div>
        </div>

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto p-4">
          <DiagnosticNotice />
              {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center">
              <div className={cn('flex size-16 items-center justify-center rounded-full', accent === 'indigo' ? 'bg-indigo-100' : 'bg-teal-100')}>
                <Bot className={cn('size-8', accentText)} />
              </div>
              <p className="mt-4 text-base font-semibold text-gray-700">你好，{user?.name ?? '用户'}</p>
              <p className="mt-1 text-sm text-gray-400">{assistantMode === 'RESEARCH' ? '总结课题进展、检索科研知识，或上传图片辅助分析' : '分析审批、安全、库存和设备事务，或上传现场图片'}</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {displayedQuickQuestions.map((q) => {
                  const Icon = q.icon;
                  return (
                    <button
                      key={q.text}
                      onClick={() => handleSend(q.text)}
                      className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-4 text-center text-sm text-gray-700 shadow-sm transition-all hover:border-teal-300 hover:shadow-md"
                    >
                      <Icon className={cn('size-5', accentText)} />
                      <span className="font-medium">{q.text}</span>
                      {q.desc && <span className="text-xs text-gray-400">{q.desc}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">

          {messages.map((msg) => (
                <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('min-w-0 max-w-[78%] rounded-2xl px-4 py-2.5', msg.role === 'user' ? cn(userBubble, 'text-white') : 'bg-gray-100 text-gray-800')}>
                    {msg.role === 'assistant' ? (
                      msg.isStreaming && !msg.content ? (
                        <div className="flex items-center gap-2 py-0.5">
                          <Loader2 className={cn('size-4 animate-spin', accentText)} />
                          <span className="text-sm text-gray-500">{agentStage || '正在生成回答…'}</span>
                        </div>
                      ) : <AssistantMessageContent content={msg.content} />
                    ) : (
                      <div className="space-y-2">
                        {msg.images && msg.images.length > 0 && (
                          <div className={cn('grid gap-2', msg.images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                            {msg.images.map((image, index) => (
                              <a
                                key={`${image.name}-${index}`}
                                href={image.dataUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block overflow-hidden rounded-xl bg-white/10"
                                title={`查看原图：${image.name}`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={image.dataUrl}
                                  alt={image.name}
                                  className="max-h-64 w-full min-w-40 object-contain"
                                />
                              </a>
                            ))}
                          </div>
                        )}
                        <p className="whitespace-pre-wrap text-sm leading-relaxed">
                          {msg.images?.length
                            ? msg.content.replace(/\n?\[附带 \d+ 张图片\]$/, '')
                            : msg.content}
                        </p>
                      </div>
                    )}
                    {msg.role === 'assistant' && !msg.isStreaming && <AnswerActions runId={msg.runId} feedback={msg.feedback} />}
                    {msg.isStreaming && <span className="ml-1 inline-block animate-pulse">▍</span>}
                    <p className={cn('mt-1 text-xs', msg.role === 'user' ? 'text-white/60' : 'text-gray-400')}>
                      {msg.timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      {msg.role === 'assistant' && ' · AI'}
                    </p>
                  </div>
                </div>
              ))}
              {isTyping && !messages.some((m) => m.isStreaming) && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl bg-gray-100 px-4 py-3">
                    <Loader2 className={cn('size-4 animate-spin', accentText)} />
                    <span className="text-sm text-gray-500">{agentStage || '正在生成回答…'}</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区（支持拖拽上传图片） */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn('relative border-t border-gray-100 p-3 transition-colors', isDragOver && 'bg-teal-50/80')}
        >
          {isDragOver && (
            <div className="pointer-events-none absolute inset-x-2 inset-y-2 z-10 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/90">
              <UploadCloud className="size-6 text-teal-500" />
              <span className="text-xs font-medium text-teal-600">松开即可上传图片或文档</span>
              <span className="text-[10px] text-teal-400">PNG / JPG / GIF / WebP，最多 5 张</span>
            </div>
          )}
          {uploadingDocument && <p role="status" className="mb-2 text-xs text-teal-700">正在保存并解析文档…</p>}
          {attachments.map(file => <div key={file.id} className="mb-2 rounded-lg border border-teal-200 bg-teal-50 p-2 text-xs text-teal-900">
            <div className="flex items-center justify-between"><span>{file.name}</span><button type="button" disabled={isTyping} aria-label={`移除 ${file.name}`} onClick={() => setAttachments(previous => previous.filter(item => item.id !== file.id))}><X className="size-4" /></button></div>
            {file.warning && <p className="mt-1 text-amber-800">{file.warning}</p>}
          </div>)}
          {images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {images.map((img, idx) => (
                <div key={idx} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.dataUrl} alt={img.name} className="size-14 rounded-lg border border-gray-200 object-cover" />
                  <button onClick={() => removeImage(idx)} className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-white">
                    <X className="size-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input ref={fileInputRef} type="file" accept="image/*,.docx,.pptx,.pdf,.txt,.md,.csv" multiple hidden onChange={handleFileChange} />
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isTyping || uploadingDocument} className="h-10 shrink-0" title="上传图片或文档（每次最多 3 个文档，单个 10MB）">
              <ImagePlus className="size-4" />
            </Button>
            <MoleculeInput disabled={isTyping} onInsert={smiles => setInput(previous => `${previous}${previous ? ' ' : ''}SMILES: ${smiles}`)} />
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={images.length > 0 ? '描述想让我分析的图片内容...' : '输入您的问题...'}
              disabled={isTyping}
              className="flex-1"
            />
            <Button
              onClick={isTyping ? stopGeneration : () => handleSend()}
              disabled={uploadingDocument || (!isTyping && !input.trim() && images.length === 0 && attachments.length === 0)}
              className={cn('h-10 shrink-0', isTyping ? 'bg-rose-600 hover:bg-rose-700' : accentBg)}
              title={isTyping ? '停止生成' : '发送'}
            >
              {isTyping ? <Square className="size-4 fill-current" /> : <Send className="size-4" />}
            </Button>
          </div>
          <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-gray-400">
            <Sparkles className="size-3" />
            当前：{assistantMode === 'RESEARCH' ? '科研助手' : '管理助手'} · 支持图片及 DOCX / PPTX / PDF / 文本 · 所有业务数据工具均为只读
            {images.length > 0 && (
              <span className="inline-flex items-center gap-1 text-teal-500">
                <FileImage className="size-3" />已选 {images.length}/5
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
