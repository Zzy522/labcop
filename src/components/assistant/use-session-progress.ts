"use client";
import { useEffect, useRef } from 'react';
import { authFetch } from '@/lib/auth-fetch';

export interface SessionMessage {
  id: string; role: 'user' | 'assistant'; content: string; createdAt: string;
  feedback?: string | null; run?: { id: string; status: string } | null;
}
export const isGenerating = (m: SessionMessage) => m.run?.status === 'RUNNING' || m.run?.status === 'CANCEL_REQUESTED';
export function visibleMessage(m: SessionMessage) {
  const running = isGenerating(m);
  let content = m.role === 'user' ? m.content.split('\n\n===DATA_BEGIN')[0] :
    !m.content && !running ? (m.run?.status === 'CANCELLED' ? '[已停止生成]' : '[未生成有效内容，请重试]') : m.content;
  if (m.run?.status === 'ERROR' && content && !content.includes('[生成失败')) content += '\n\n[生成未完成，已保留现有内容。可重新提问。]';
  return { ...m, content, timestamp: new Date(m.createdAt), runId: m.run?.id, isStreaming: running };
}
/** Poll only the visible running conversation. Leaving the view never cancels generation. */
export function useSessionProgress(sessionId: string | null, revision: number, onMessages: (messages: SessionMessage[]) => void) {
  const callback = useRef(onMessages);
  useEffect(() => { callback.current = onMessages; });
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let again = true;
      try {
        const response = await authFetch(`/api/assistant/sessions/${sessionId}`, { signal: controller.signal, cache: 'no-store' });
        if ([401, 403, 404].includes(response.status)) return;
        if (!response.ok) throw new Error('暂时无法读取进度');
        const data = await response.json();
        if (controller.signal.aborted) return;
        callback.current(data.messages);
        again = data.messages.some(isGenerating);
      } catch { /* Temporary network failures do not turn a running answer into an error. */ }
      if (again && !controller.signal.aborted) timer = setTimeout(poll, 1500);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [sessionId, revision]);
}
