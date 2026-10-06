"use client";

import { clampFloating, snapFloating } from '@/lib/floating-geometry';
import { useSessionProgress, visibleMessage, isGenerating } from './use-session-progress';
import { MoleculeInput } from '@/components/assistant/molecule-input';
import { DiagnosticNotice } from '@/components/assistant/diagnostic-notice';
import { AnswerActions } from '@/components/assistant/answer-actions';
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Bot, Send, Loader2, X, Sparkles, GripHorizontal, History, Plus, Trash2, FlaskConical, ShieldCheck, ImagePlus, UploadCloud, FileImage } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/auth-fetch";
import { AssistantMessageContent } from "@/components/assistant/assistant-message-content";

interface AttachmentImage {
  name: string;
  dataUrl: string;
}

interface ChatMessage {
  runId?: string;
  feedback?: string | null;
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  images?: AttachmentImage[];
}

const MAX_ATTACH_IMAGES = 5;
const MAX_ATTACH_FILE_SIZE = 5 * 1024 * 1024; // 单张 5MB
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

interface SessionListItem {
  id: string;
  title: string;
  role: string;
  assistantMode: AssistantMode;
  lastActiveAt: string;
  createdAt: string;
  _count: { messages: number };
}

type AssistantMode = "RESEARCH" | "MANAGEMENT";

interface FloatingChatProps {
  /** 角色：admin=管理员端（管理决策助理），user=实验员端（安全咨询助手）*/
  role?: "admin" | "user";
}

// 实验员端：安全咨询助手
const USER_QUICK_QUESTIONS = [
  "试剂使用注意事项",
  "设备预约流程",
  "我的巡检任务",
  "安全操作规范",
];
const USER_WELCOME_TEXT = "您好！我是实验室安全助手，可以解答试剂、设备、巡检等安全问题。";
const USER_SUBTITLE = "实验室安全管家";

// 管理员端：管理决策助理（权限和提示词与实验员端隔离）
const ADMIN_QUICK_QUESTIONS = [
  "本周实验室安全概况",
  "待审批事项有哪些",
  "低库存试剂清单",
  "生成安全月报摘要",
];
const ADMIN_WELCOME_TEXT = "您好！我是实验室管理决策助理，可以帮您分析安全态势、审查申请、生成报告。";
const ADMIN_TITLE = "管理决策助理";
const ADMIN_SUBTITLE = "管理员专属 · 权限隔离";

const RESEARCH_QUICK_QUESTIONS = [
  "总结我参与课题的近期进展",
  "梳理阶段任务和阻塞项",
  "近期哪些课题数据有更新",
  "分析化合物与活性结果",
];

const BTN_SIZE = 56; // 悬浮按钮尺寸
const SNAP_THRESHOLD = 48;
const PANEL_WIDTH = 420;
const PANEL_HEIGHT = 600;

export function FloatingChat({ role = "user" }: FloatingChatProps) {
  const isAdmin = role === "admin";
  const [assistantMode, setAssistantMode] = useState<AssistantMode>(isAdmin ? "MANAGEMENT" : "RESEARCH");
  const QUICK_QUESTIONS = assistantMode === "RESEARCH" ? RESEARCH_QUICK_QUESTIONS : isAdmin ? ADMIN_QUICK_QUESTIONS : USER_QUICK_QUESTIONS;
  const WELCOME_TEXT = assistantMode === "RESEARCH" ? "我是科研助手，可以总结课题、梳理阶段任务并分析科研数据。" : isAdmin ? ADMIN_WELCOME_TEXT : USER_WELCOME_TEXT;
  const TITLE = assistantMode === "RESEARCH" ? "科研助手" : isAdmin ? ADMIN_TITLE : "管理助手";
  const SUBTITLE = assistantMode === "RESEARCH" ? "课题总结 · 科研知识" : isAdmin ? ADMIN_SUBTITLE : USER_SUBTITLE;
  // 管理员端使用蓝紫色调，实验员端使用青绿色调
  const btnGradient = isAdmin
    ? "from-indigo-500 to-blue-600 shadow-indigo-500/30"
    : "from-teal-500 to-cyan-600 shadow-teal-500/30";
  const headerGradient = isAdmin
    ? "from-indigo-600 to-blue-600"
    : "from-teal-600 to-cyan-600";
  const accentColor = isAdmin ? "text-indigo-600" : "text-teal-600";
  const sendBtnBg = isAdmin ? "bg-indigo-600 hover:bg-indigo-700" : "bg-teal-600 hover:bg-teal-700";
  const pingBg = isAdmin ? "bg-indigo-300" : "bg-teal-300";
  const pingDot = isAdmin ? "bg-indigo-400" : "bg-teal-400";
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [agentStage, setAgentStage] = useState("");
  // 流式输出：当前正在生成的 assistant 消息 ID
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  // 会话管理
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 流式 abort 控制器
  const viewRevision = useRef(0);
  const [progressRevision, setProgressRevision] = useState(0);
  useSessionProgress(currentSessionId, progressRevision, items => {
    setMessages(items.map(visibleMessage));
    setIsTyping(items.some(isGenerating));
    setStreamingMessageId(items.find(isGenerating)?.id ?? null);
    setAgentStage(items.some(isGenerating) ? '正在后台生成，可切换页面或会话…' : '');
  });
  // localStorage key（按角色区分）
  const SESSION_STORAGE_KEY = `lab-safety:chat-session:${role}:${assistantMode}`;
  const MODE_STORAGE_KEY = `lab-cop:assistant-mode:${role}`;

  // ─── 拖拽与吸附状态 ───
  // 按钮位置（null = 默认右下角，通过 CSS right/bottom 定位）
  const [btnPos, setBtnPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingBtn, setIsDraggingBtn] = useState(false);
  const [snappedEdge, setSnappedEdge] = useState<'left' | 'right' | null>(null);
  const isSnapped = snappedEdge !== null;
  const [isHovering, setIsHovering] = useState(false);

  // 聊天面板位置
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);

  // 拖拽辅助 refs
  const btnDragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const panelDragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const hasDragged = useRef(false);

  // 客户端挂载后才渲染浮窗（避免 portal 水合不匹配）
  // set-state-in-effect 在此为必要模式：SSR 时 mounted 必须为 false，挂载后才能渲染 fixed 定位元素
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    try {
      const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
      if (savedMode === "RESEARCH" || savedMode === "MANAGEMENT") setAssistantMode(savedMode);
    } catch {
      // ignore
    }
  }, [MODE_STORAGE_KEY]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (open) scrollToBottom();
  }, [messages, isTyping, open, scrollToBottom]);

  const addMessage = useCallback((role: "user" | "assistant", content: string, images?: AttachmentImage[]) => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, role, content, timestamp: new Date(), ...(images && images.length > 0 ? { images } : {}) },
    ]);
  }, []);

  // ─── 图片上传（点击选择 + 拖拽） ───
  const [images, setImages] = useState<AttachmentImage[]>([]);
  const [documents, setDocuments] = useState<Array<{ id: string; name: string; warning: string }>>([]);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const documentUploadLock = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadHint, setUploadHint] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFileAsDataUrl = useCallback((file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  }), []);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    if (isTyping || documentUploadLock.current) return;
    const files = Array.from(fileList);
    if (files.length === 0) return;
    const imageFiles = files.filter((file) => ACCEPTED_IMAGE_TYPES.includes(file.type));
    setUploadHint(null);
    const documentFiles = files.filter(file => !ACCEPTED_IMAGE_TYPES.includes(file.type));
    if (documentFiles.length) {
      documentUploadLock.current = true;
      setUploadingDocument(true);
      try {
        if (documentFiles.length + documents.length > 3) throw new Error('每次最多 3 个文档');
        for (const file of documentFiles) {
          if (file.size > 10 * 1024 * 1024) throw new Error('单个文档不能超过 10MB');
          const form = new FormData(); form.append('file', file);
          const res = await authFetch('/api/assistant/attachments', { method: 'POST', body: form });
          const result = await res.json();
          if (!res.ok) throw new Error(result.error || '解析失败');
          setDocuments(previous => [...previous, result.data]);
        }
      } catch (error) { setUploadHint(error instanceof Error ? error.message : '上传失败'); }
      finally { setUploadingDocument(false); documentUploadLock.current = false; }
    }
    const room = MAX_ATTACH_IMAGES - images.length;
    const accepted = imageFiles.slice(0, Math.max(0, room));
    if (imageFiles.length > room) {
      setUploadHint(`最多同时上传 ${MAX_ATTACH_IMAGES} 张图片，已忽略 ${imageFiles.length - room} 张`);
    }
    const oversized = accepted.filter((file) => file.size > MAX_ATTACH_FILE_SIZE);
    if (oversized.length > 0) {
      setUploadHint(`图片「${oversized[0].name}」超过 5MB，已忽略`);
    }
    const pending = accepted.filter((file) => file.size <= MAX_ATTACH_FILE_SIZE);
    const dataUrls = await Promise.all(pending.map((file) => readFileAsDataUrl(file)));
    setImages((prev) => [...prev, ...dataUrls.map((dataUrl, index) => ({ name: pending[index].name, dataUrl }))]);
  }, [images.length, documents.length, isTyping, readFileAsDataUrl]);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
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
      void handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  // 加载会话列表
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const res = await authFetch(`/api/assistant/sessions?assistantMode=${assistantMode}`);
      const data = await res.json();
      if (res.ok && data?.data) {
        setSessions(data.data);
      }
    } catch {
      // 静默失败
    } finally {
      setLoadingSessions(false);
    }
  }, [assistantMode]);

  // 切换到指定会话
  const switchToSession = useCallback(async (sessionId: string) => {
    const revision = ++viewRevision.current;
    try {
      const res = await authFetch(`/api/assistant/sessions/${sessionId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      if (data?.session?.assistantMode && data.session.assistantMode !== assistantMode) {
        throw new Error("该会话属于另一助手模式");
      }

      if (revision !== viewRevision.current) return;
      // 用历史消息替换当前消息
      setMessages(data.messages.map(visibleMessage));
      setIsTyping(data.messages.some(isGenerating));
      setStreamingMessageId(data.messages.find(isGenerating)?.id ?? null);
      setProgressRevision(n => n + 1);
      setCurrentSessionId(sessionId);
      // 持久化到 localStorage
      try {
        localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
      } catch {
        // localStorage 不可用时静默失败
      }
      setShowHistory(false);
    } catch (err) {
      console.error("加载会话失败:", err);
    }
  }, [SESSION_STORAGE_KEY, assistantMode]);

  // 新建会话
  const startNewSession = useCallback(() => {
    ++viewRevision.current;
    setIsTyping(false);
    setStreamingMessageId(null);
    setAgentStage('');
    setMessages([]);
    setCurrentSessionId(null);
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setShowHistory(false);
  }, [SESSION_STORAGE_KEY]);

  const switchAssistantMode = useCallback((nextMode: AssistantMode) => {
    if (nextMode === assistantMode) return;
    ++viewRevision.current;
    setIsTyping(false);
    setStreamingMessageId(null);
    setMessages([]);
    setCurrentSessionId(null);
    setShowHistory(false);
    setAssistantMode(nextMode);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, nextMode);
    } catch {
      // ignore
    }
  }, [assistantMode, MODE_STORAGE_KEY]);

  // 删除会话
  const deleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await authFetch(`/api/assistant/sessions?id=${sessionId}`, { method: "DELETE" });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        if (currentSessionId === sessionId) {
          startNewSession();
        }
      }
    } catch {
      // ignore
    }
  }, [currentSessionId, startNewSession]);

  const sendMessage = useCallback(
    async (text: string, attachments?: AttachmentImage[]) => {
      const hasAttachments = attachments !== undefined && attachments.length > 0;
      if ((!text.trim() && !hasAttachments && documents.length === 0) || isTyping || uploadingDocument) return;
      text = text.trim() || '请分析上传的资料，说明读取范围与主要内容。';
      addMessage("user", text + (documents.length ? `\n[附件：${documents.map(file => file.name).join('、')}]` : ''), attachments);
      setInputValue("");
      setImages([]);
      setUploadHint(null);
      setIsTyping(true);
      setAgentStage(hasAttachments ? "已接收图片，正在准备视觉分析…" : "正在路由到助手…");

      // 创建 assistant 占位消息（流式填充）
      const assistantMsgId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setStreamingMessageId(assistantMsgId);
      setMessages((prev) => [
        ...prev,
        { id: assistantMsgId, role: "assistant", content: "", timestamp: new Date() },
      ]);

      const revision = viewRevision.current;
      try {
        const response = await authFetch('/api/assistant/chat', {
          method: 'POST', body: JSON.stringify({ background: true, messages: [{ role: 'user', content: text }],
            images: attachments, attachmentIds: documents.map(file => file.id), role: isAdmin ? 'admin' : 'user', assistantMode, sessionId: currentSessionId }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '提交失败');
        localStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
        if (revision !== viewRevision.current) return;
        setDocuments([]);
        setCurrentSessionId(data.sessionId);
        setProgressRevision(n => n + 1);
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, id: data.messageId, runId: data.runId } : m));
        setStreamingMessageId(data.messageId);
        setAgentStage('正在后台生成，可切换页面或会话…');
      } catch (error) {
        if (revision !== viewRevision.current) return;
        setIsTyping(false); setStreamingMessageId(null); setAgentStage('');
        setMessages(prev => prev.map(m => m.id === assistantMsgId ? { ...m, content: error instanceof Error ? error.message : '提交失败，请检查会话记录后重试' } : m));
      }
    }, [addMessage, isTyping, documents, uploadingDocument, isAdmin, assistantMode, currentSessionId, SESSION_STORAGE_KEY]
  );

  const stopStreaming = useCallback(async () => {
    const runId = messages.find(m => m.id === streamingMessageId)?.runId;
    if (!runId) return;
    try {
      const response = await authFetch(`/api/assistant/generations/${runId}/cancel`, { method: 'POST' });
      if (!response.ok) throw new Error('停止失败，请重试');
      setAgentStage('正在停止…');
    } catch { setAgentStage('停止失败，请重试'); }
  }, [messages, streamingMessageId]);

  // 打开浮窗时尝试恢复上次会话
  useEffect(() => {
    if (!open || currentSessionId || messages.length > 0) return;
    try {
      const savedSessionId = localStorage.getItem(SESSION_STORAGE_KEY);
      if (savedSessionId) {
        switchToSession(savedSessionId);
      }
    } catch {
      // ignore
    }
  }, [open, currentSessionId, messages.length, SESSION_STORAGE_KEY, switchToSession]);

  // 打开历史面板时加载会话列表
  useEffect(() => {
    if (showHistory) {
      loadSessions();
    }
  }, [showHistory, loadSessions]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage(inputValue, images);
      }
    },
    [sendMessage, inputValue, images]
  );

  // Pointer events support mouse, pen and touch; panel controls never initiate a drag.
  const viewport = () => ({ x: window.innerWidth, y: window.innerHeight });
  const panelSize = () => ({ x: Math.min(PANEL_WIDTH, window.innerWidth - 16), y: Math.min(PANEL_HEIGHT, window.innerHeight * 0.85) });
  const handleBtnMouseDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    btnDragStart.current = { mouseX: e.clientX, mouseY: e.clientY, posX: rect.x, posY: rect.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingBtn(true); hasDragged.current = false;
  }, []);
  useEffect(() => {
    if (!isDraggingBtn) return;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - btnDragStart.current.mouseX, dy = e.clientY - btnDragStart.current.mouseY;
      if (Math.hypot(dx, dy) <= 5 && !hasDragged.current) return;
      hasDragged.current = true; setSnappedEdge(null);
      setBtnPos(clampFloating({ x: btnDragStart.current.posX + dx, y: btnDragStart.current.posY + dy }, viewport(), { x: BTN_SIZE, y: BTN_SIZE }));
    };
    const up = () => {
      setIsDraggingBtn(false);
      if (!hasDragged.current) return;
      setBtnPos(previous => {
        if (!previous) return previous;
        const snapped = snapFloating(previous, viewport(), { x: BTN_SIZE, y: BTN_SIZE }, SNAP_THRESHOLD);
        setSnappedEdge(snapped.edge);
        try { localStorage.setItem('lab-cop:floating-position', JSON.stringify(snapped)); } catch { /* optional preference */ }
        return snapped.position;
      });
    };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
  }, [isDraggingBtn]);
  const handleBtnClick = useCallback(() => {
    if (hasDragged.current) { hasDragged.current = false; return; }
    setOpen(true);
    setPanelPos(previous => clampFloating(previous ?? { x: snappedEdge === 'left' ? 8 : window.innerWidth - PANEL_WIDTH - 8, y: (btnPos?.y ?? window.innerHeight) - PANEL_HEIGHT }, viewport(), panelSize()));
  }, [btnPos, snappedEdge]);
  const handlePanelHeaderMouseDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, a')) return;
    const rect = e.currentTarget.parentElement!.getBoundingClientRect();
    panelDragStart.current = { mouseX: e.clientX, mouseY: e.clientY, posX: rect.x, posY: rect.y };
    e.currentTarget.setPointerCapture(e.pointerId); setIsDraggingPanel(true);
  }, []);
  useEffect(() => {
    if (!isDraggingPanel) return;
    const move = (e: PointerEvent) => setPanelPos(clampFloating({ x: panelDragStart.current.posX + e.clientX - panelDragStart.current.mouseX, y: panelDragStart.current.posY + e.clientY - panelDragStart.current.mouseY }, viewport(), panelSize()));
    const up = () => { setIsDraggingPanel(false); setPanelPos(previous => previous ? snapFloating(previous, viewport(), panelSize(), 32).position : previous); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    return () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up); };
  }, [isDraggingPanel]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('lab-cop:floating-position') || 'null');
      if (saved && Number.isFinite(saved.position?.x) && Number.isFinite(saved.position?.y)) {
        const edge = saved.edge === 'left' || saved.edge === 'right' ? saved.edge : null;
        setSnappedEdge(edge);
        setBtnPos(clampFloating({ ...saved.position, x: edge === 'right' ? window.innerWidth - BTN_SIZE - 8 : edge === 'left' ? 8 : saved.position.x }, viewport(), { x: BTN_SIZE, y: BTN_SIZE }));
      }
    } catch { /* invalid or unavailable preference */ }
  }, []);
  useEffect(() => {
    const resize = () => {
      setBtnPos(previous => previous ? clampFloating({ ...previous, x: snappedEdge === 'right' ? window.innerWidth - BTN_SIZE - 8 : snappedEdge === 'left' ? 8 : previous.x }, viewport(), { x: BTN_SIZE, y: BTN_SIZE }) : previous);
      setPanelPos(previous => previous ? clampFloating(previous, viewport(), panelSize()) : previous);
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [snappedEdge]);

  if (!mounted) return null;

  // 按钮样式：使用 left/top 或默认 right/bottom
  const btnStyle: React.CSSProperties = btnPos
    ? { left: btnPos.x, top: btnPos.y }
    : { right: 24, bottom: 24 };

  // 面板样式
  const panelStyle: React.CSSProperties = panelPos
    ? { left: panelPos.x, top: panelPos.y }
    : { right: 24, bottom: 24 };

  return (
    <>
      {/* 悬浮按钮（聊天关闭时显示）*/}
      {!open && (
        <div
          style={btnStyle}
          className={cn("fixed z-50", !isDraggingBtn && "transition-[left,top] duration-200")}
          onMouseEnter={() => isSnapped && setIsHovering(true)}
          onMouseLeave={() => isSnapped && setIsHovering(false)}
        >
          <button
            onPointerDown={handleBtnMouseDown}
            onFocus={() => setIsHovering(true)} onBlur={() => setIsHovering(false)}
            onClick={handleBtnClick}
            className={cn(
              "flex size-14 touch-none cursor-grab items-center justify-center rounded-full bg-gradient-to-br text-white shadow-lg transition-all hover:scale-110 hover:shadow-xl active:cursor-grabbing",
              btnGradient,
              isSnapped && !isHovering && !isDraggingBtn && (snappedEdge === "left" ? "-translate-x-1/2 opacity-80" : "translate-x-1/2 opacity-80"),
              isSnapped && isHovering && "translate-x-0",
              isDraggingBtn && "cursor-grabbing scale-110"
            )}
            aria-label={isAdmin ? "打开管理决策助理" : "打开智能助手"}
          >
            <Bot className="size-6" />
            <span className="absolute -top-1 -right-1 flex size-3">
              <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-75", pingBg)} />
              <span className={cn("relative inline-flex size-3 rounded-full", pingDot)} />
            </span>
          </button>
          {/* 吸附状态下的提示条（鼠标靠近时显示）*/}
          {isSnapped && !isHovering && (
            <div className={cn("pointer-events-none absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 whitespace-nowrap rounded-l-md px-2 py-1 text-[10px] text-white opacity-0 transition-opacity", isAdmin ? "bg-indigo-600/80" : "bg-teal-600/80")}>
              拖拽移动 · 点击展开
            </div>
          )}
        </div>
      )}

      {/* 聊天面板 */}
      {open &&
        createPortal(
          <div
            style={panelStyle}
            className="fixed z-50 flex h-[600px] max-h-[85vh] w-[min(420px,calc(100vw-16px))] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
          >
            {/* 标题栏（可拖拽）*/}
            <div
              onPointerDown={handlePanelHeaderMouseDown}
              className={cn(
                "flex touch-none cursor-grab items-center justify-between bg-gradient-to-r px-4 py-3 text-white select-none",
                headerGradient,
                isDraggingPanel && "cursor-grabbing"
              )}
            >
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-white/20">
                  <Bot className="size-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{TITLE}</p>
                  <p className={cn("text-[10px]", isAdmin ? "text-indigo-100" : "text-teal-100")}>{SUBTITLE}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <GripHorizontal className="size-4 text-white/40" />
                <button
                  onClick={() => startNewSession()}
                  className="rounded-lg p-1.5 transition-colors hover:bg-white/20"
                  aria-label="新建会话"
                  title="新建会话"
                >
                  <Plus className="size-4" />
                </button>
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className={cn(
                    "rounded-lg p-1.5 transition-colors hover:bg-white/20",
                    showHistory && "bg-white/30"
                  )}
                  aria-label="历史会话"
                  title="历史会话"
                >
                  <History className="size-4" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1.5 transition-colors hover:bg-white/20"
                  aria-label="关闭"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex border-b border-gray-100 bg-white p-2">
              <div className="mx-auto flex rounded-lg bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => switchAssistantMode("RESEARCH")}
                  className={cn("flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition", assistantMode === "RESEARCH" ? "bg-white text-violet-700 shadow-sm" : "text-gray-500")}
                >
                  <FlaskConical className="size-3.5" />科研助手
                </button>
                <button
                  type="button"
                  onClick={() => switchAssistantMode("MANAGEMENT")}
                  className={cn("flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition", assistantMode === "MANAGEMENT" ? "bg-white text-sky-700 shadow-sm" : "text-gray-500")}
                >
                  <ShieldCheck className="size-3.5" />管理助手
                </button>
              </div>
            </div>

            {/* 历史会话抽屉 */}
            {showHistory && (
              <div className="border-b border-gray-100 bg-gray-50/80 max-h-48 overflow-y-auto">
                {loadingSessions ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className={cn("size-4 animate-spin", accentColor)} />
                    <span className="ml-2 text-xs text-gray-500">加载中...</span>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="py-4 text-center text-xs text-gray-400">暂无历史会话</div>
                ) : (
                  <div className="py-1">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => switchToSession(s.id)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs hover:bg-white",
                          s.id === currentSessionId && "bg-white"
                        )}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="truncate font-medium text-gray-700">{s.title || "无标题"}</div>
                          <div className="text-[10px] text-gray-400">
                            {new Date(s.lastActiveAt).toLocaleString("zh-CN")} · {s._count.messages} 条消息
                          </div>
                        </div>
                        <button
                          onClick={(e) => deleteSession(s.id, e)}
                          className="shrink-0 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
                          aria-label="删除会话"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 消息区 */}
            <div className="flex-1 overflow-y-auto bg-gray-50/50 p-4">
              <DiagnosticNotice />
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className={cn("flex size-14 items-center justify-center rounded-full bg-gradient-to-br", isAdmin ? "from-indigo-100 to-blue-100" : "from-teal-100 to-cyan-100")}>
                    <Bot className={cn("size-7", accentColor)} />
                  </div>
                  <p className="mt-3 text-sm font-medium text-gray-700">{WELCOME_TEXT}</p>
                  <div className="mt-5 grid w-full gap-2">
                    {QUICK_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        onClick={() => sendMessage(q)}
                        className={cn(
                          "rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-xs text-gray-600 transition-all",
                          isAdmin ? "hover:border-indigo-300 hover:bg-indigo-50" : "hover:border-teal-300 hover:bg-teal-50"
                        )}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">

          {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                          msg.role === "user"
                            ? isAdmin ? "bg-indigo-600 text-white" : "bg-teal-600 text-white"
                            : "bg-white text-gray-800 shadow-sm ring-1 ring-gray-100"
                        )}
                      >
                        {/* 流式输出时光标 */}
                        {msg.id === streamingMessageId && !msg.content ? (
                          <span className="inline-flex items-center gap-1">
                            <Loader2 className={cn("size-3 animate-spin", accentColor)} />
                            <span className="text-xs text-gray-400">{agentStage || "正在生成回答…"}</span>
                          </span>
                        ) : (
                          <div>
                            {msg.role === "assistant" ? (
                              <AssistantMessageContent content={msg.content} compact />
                            ) : (
                              <>
                                {msg.images && msg.images.length > 0 && (
                                  <div className="mb-1.5 flex flex-wrap gap-1.5">
                                    {msg.images.map((img, index) => (
                                      <img
                                        key={`${msg.id}-${index}`}
                                        src={img.dataUrl}
                                        alt={img.name}
                                        className="size-14 rounded-md border border-white/30 object-cover"
                                        loading="lazy"
                                      />
                                    ))}
                                  </div>
                                )}
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                              </>
                            )}
                            {msg.role === 'assistant' && msg.id !== streamingMessageId && <AnswerActions runId={msg.runId} feedback={msg.feedback} />}
                            {msg.id === streamingMessageId && (
                              <span className={cn("ml-0.5 inline-block w-1 animate-pulse", accentColor)}>▌</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* 输入区（支持拖拽上传图片） */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                "relative border-t border-gray-100 bg-white p-3 transition-colors",
                isDragOver && "bg-teal-50/80"
              )}
            >
              {isDragOver && (
                <div className="pointer-events-none absolute inset-x-2 inset-y-2 flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/90">
                  <UploadCloud className="size-6 text-teal-500" />
                  <span className="text-xs font-medium text-teal-600">松开即可上传图片</span>
                  <span className="text-[10px] text-teal-400">PNG / JPG / GIF / WebP，最多 {MAX_ATTACH_IMAGES} 张</span>
                </div>
              )}
              {uploadingDocument && <p role="status" className="mb-2 text-xs text-teal-700">正在保存并解析文档…</p>}
              {documents.map(file => <div key={file.id} className="mb-2 rounded-lg border border-teal-200 bg-teal-50 p-2 text-xs text-teal-900"><div className="flex justify-between"><span>{file.name}</span><button type="button" disabled={isTyping} aria-label={`移除 ${file.name}`} onClick={() => setDocuments(previous => previous.filter(item => item.id !== file.id))}><X className="size-4" /></button></div>{file.warning && <p className="mt-1 text-amber-800">{file.warning}</p>}</div>)}
              {images.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {images.map((img, index) => (
                    <div key={`${img.name}-${index}`} className="group relative">
                      <img src={img.dataUrl} alt={img.name} className="size-12 rounded-lg border border-gray-200 object-cover" />
                      <button
                        onClick={() => removeImage(index)}
                        className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-gray-700/80 text-white transition-colors hover:bg-red-500"
                        aria-label="移除图片"
                        title="移除图片"
                      >
                        <X className="size-2.5" />
                      </button>
                      <span className="absolute bottom-0 left-0 right-0 truncate rounded-b-lg bg-black/40 px-0.5 text-[8px] text-white">
                        {img.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isTyping || uploadingDocument}
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors disabled:opacity-40",
                    isAdmin ? "border-indigo-200 text-indigo-500 hover:bg-indigo-50" : "border-teal-200 text-teal-500 hover:bg-teal-50"
                  )}
                  aria-label="上传图片或文档"
                  title="上传图片、DOCX、PPTX、PDF 或文本（支持拖拽）"
                >
                  <ImagePlus className="size-4" />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES.join(",") + ',.docx,.pptx,.pdf,.txt,.md,.csv'}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) void handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <MoleculeInput disabled={isTyping} onInsert={smiles => setInputValue(previous => `${previous}${previous ? ' ' : ''}SMILES: ${smiles}`)} />
                <Input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isDragOver ? "松开上传" : "输入问题，可拖拽图片或文档…"}
                  disabled={isTyping}
                  className="flex-1"
                />
                {isTyping ? (
                  <button
                    onClick={stopStreaming}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gray-200 text-gray-600 transition-colors hover:bg-gray-300"
                    aria-label="停止生成"
                    title="停止生成"
                  >
                    <span className="size-3 rounded-sm bg-gray-600" />
                  </button>
                ) : (
                  <button
                    onClick={() => sendMessage(inputValue, images)}
                    disabled={(!inputValue.trim() && images.length === 0 && documents.length === 0) || isTyping || uploadingDocument}
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg text-white transition-colors disabled:opacity-40",
                      sendBtnBg
                    )}
                    aria-label="发送"
                  >
                    <Send className="size-4" />
                  </button>
                )}
              </div>
              <p className={cn("mt-1.5 text-center text-[10px]", isAdmin ? "text-indigo-400" : "text-teal-400")}>
                <Sparkles className="mr-1 inline-block size-2.5 align-middle" />
                {uploadHint ? (
                  <span className="font-medium text-amber-500">{uploadHint}</span>
                ) : (
                  <span>
                    {images.length > 0 ? (
                      <>
                        <FileImage className="mr-1 inline-block size-2.5 align-middle" />
                        已选 {images.length}/{MAX_ATTACH_IMAGES} 张图片
                      </>
                    ) : (
                      "支持图片、DOCX、PPTX、PDF、文本；文档单个 10MB"
                    )}
                  </span>
                )}
              </p>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
