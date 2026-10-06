"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import type { KetcherApi } from "@/lib/ketcher";

interface KetcherEditorProps {
  onInit?: (ketcher: KetcherApi) => void;
  onError?: (message: string) => void;
}

/**
 * Ketcher 分子绘图编辑器（iframe 方式）
 *
 * 使用 public/ketcher/index.html 中的 Ketcher Standalone v2.6.3 预构建应用，
 * 通过同源 iframe 访问 window.ketcher 全局 API。
 *
 * 关键依赖：next.config.ts 的安全响应头必须允许同源 framing
 * （X-Frame-Options: SAMEORIGIN + CSP frame-ancestors 'self'），
 * 否则浏览器会拒绝在同源 iframe 中加载 /ketcher/index.html，
 * 表现为 iframe 显示“localhost 拒绝连接”且 window.ketcher 永远不可用。
 *
 * 就绪检测采用双重机制：
 *  1) 监听 Ketcher 通过 window.parent.postMessage 上报的 init 事件（快路径）；
 *  2) 兜底轮询 iframe.contentWindow.ketcher（慢路径，最多等待 30s）。
 */
export function KetcherEditor({ onInit, onError }: KetcherEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onInitRef = useRef(onInit);
  const onErrorRef = useRef(onError);
  const doneRef = useRef(false);
  const [loading, setLoading] = useState(true);

  // 保持回调最新
  useEffect(() => {
    onInitRef.current = onInit;
    onErrorRef.current = onError;
  }, [onInit, onError]);

  const finishWith = useCallback((ketcher: KetcherApi) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setLoading(false);
    // 暴露到当前窗口方便调试
    if (typeof window !== "undefined") {
      (window as Window & { ketcher?: KetcherApi }).ketcher = ketcher;
    }
    onInitRef.current?.(ketcher);
  }, []);

  const failWith = useCallback((msg: string) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setLoading(false);
    onErrorRef.current?.(msg);
  }, []);

  // 主动探测一次 iframe 内的 ketcher 全局对象
  const probeKetcher = useCallback(() => {
    if (doneRef.current) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const ketcher = (iframe.contentWindow as Window & { ketcher?: KetcherApi })?.ketcher;
      if (ketcher) {
        finishWith(ketcher);
        return true;
      }
    } catch {
      // 跨域访问异常（理论上同源不会发生，除非 iframe 被导航到错误页）
    }
    return false;
  }, [finishWith]);

  // 监听 Ketcher 通过 postMessage 上报的 init 事件，作为快路径
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (doneRef.current) return;
      const iframe = iframeRef.current;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (data && typeof data === "object") {
        const type = String(data.eventType || data.type || "").toLowerCase();
        if (type.includes("init") || type.includes("ready") || type.includes("ketcher")) {
          // 收到就绪信号后立即探测一次
          probeKetcher();
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [probeKetcher]);

  const handleIframeLoad = useCallback(() => {
    if (doneRef.current) return;
    // 立即探测一次（可能在 load 时已就绪）
    if (probeKetcher()) return;

    let attempts = 0;
    const maxAttempts = 150; // 最多等待 30 秒（Ketcher + Indigo 初始化可能较慢）
    pollRef.current = setInterval(() => {
      attempts++;
      if (probeKetcher()) return;
      if (attempts >= maxAttempts) {
        failWith(
          "无法访问 Ketcher 实例（已等待 30 秒）。请刷新页面重试；若持续失败，请确认 /ketcher/index.html 可正常访问且未被安全策略拦截同源 iframe。"
        );
      }
    }, 200);
  }, [probeKetcher, failWith]);

  useEffect(() => {
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (typeof window !== "undefined") {
        delete (window as Window & { ketcher?: KetcherApi }).ketcher;
      }
    };
  }, []);

  return (
    <div className="relative h-[440px] w-full bg-white" aria-busy={loading}>
      <iframe
        ref={iframeRef}
        src="/ketcher/index.html"
        title="Ketcher 分子编辑器"
        loading="eager"
        onLoad={handleIframeLoad}
        onError={() => failWith("Ketcher 页面加载失败，请检查网络后重试")}
        className="block size-full rounded-lg border-0 bg-white"
      />
      {loading && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/95 text-gray-500"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="size-7 animate-spin text-cyan-600" />
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">正在加载分子绘图器</p>
            <p className="mt-1 text-xs text-gray-400">首次加载可能需要几秒钟</p>
          </div>
        </div>
      )}
    </div>
  );
}
