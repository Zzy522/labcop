'use client';

/**
 * 轻量 Toast 组件
 *
 * 设计目标：
 * - 零依赖（不引入 sonner 等第三方库）
 * - 与 Tailwind 兼容（避免 ArcoDesign Message 与 Tailwind 的冲突）
 * - 全局 API：toast.success/error/info/warning 可在任意位置调用
 * - 支持操作按钮（用于 actionUrl 引导）
 *
 * 使用方式：
 *   import { toast } from '@/components/ui/toast';
 *   toast.success('保存成功');
 *   toast.error('网络异常', { action: { label: '重试', onClick: () => ... } });
 *
 * 注意：必须在客户端组件树中渲染一次 <ToastContainer />（已在 RootLayout 注入）
 */

import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertCircle, CheckCircle2, Info, AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** 持续时间（毫秒），默认 5000；有 action 时默认 10000 */
  duration?: number;
  /** 操作按钮 */
  action?: ToastAction;
  /** 是否可手动关闭（默认 true） */
  dismissible?: boolean;
}

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  dismissible: boolean;
}

// ─── 全局事件订阅（外部模块用 toast.xxx 触发，组件用 useSyncExternalStore 订阅）───

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return toasts;
}

function addToast(message: string, variant: ToastVariant, options: ToastOptions = {}) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: ToastItem = {
    id,
    message,
    variant,
    action: options.action,
    dismissible: options.dismissible !== false,
  };
  toasts = [...toasts, item];
  emitChange();

  // 自动消失
  const duration = options.duration ?? (options.action ? 10000 : 5000);
  if (duration > 0) {
    setTimeout(() => removeToast(id), duration);
  }
}

function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emitChange();
}

// ─── 全局 API：在任意客户端代码中调用 ───

export const toast = {
  success: (message: string, options?: ToastOptions) => addToast(message, 'success', options),
  error: (message: string, options?: ToastOptions) => addToast(message, 'error', options),
  warning: (message: string, options?: ToastOptions) => addToast(message, 'warning', options),
  info: (message: string, options?: ToastOptions) => addToast(message, 'info', options),
  dismiss: (id: string) => removeToast(id),
};

// ─── 视图组件 ───

const VARIANT_CONFIG: Record<ToastVariant, { icon: typeof AlertCircle; iconColor: string; barColor: string; bgClass: string }> = {
  success: {
    icon: CheckCircle2,
    iconColor: 'text-emerald-500',
    barColor: 'bg-emerald-500',
    bgClass: 'bg-white border-emerald-100',
  },
  error: {
    icon: AlertCircle,
    iconColor: 'text-red-500',
    barColor: 'bg-red-500',
    bgClass: 'bg-white border-red-100',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    barColor: 'bg-amber-500',
    bgClass: 'bg-white border-amber-100',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-500',
    barColor: 'bg-blue-500',
    bgClass: 'bg-white border-blue-100',
  },
};

export function ToastContainer() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed top-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {items.map((item) => {
        const cfg = VARIANT_CONFIG[item.variant];
        const Icon = cfg.icon;
        return (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-xl border p-4 shadow-lg ring-1 ring-black/5',
              'animate-in slide-in-from-right-5 fade-in duration-300',
              cfg.bgClass
            )}
            role="alert"
          >
            {/* 左侧色条 */}
            <div className={cn('absolute left-0 top-0 h-full w-1', cfg.barColor)} />

            <Icon className={cn('mt-0.5 size-5 shrink-0', cfg.iconColor)} />

            <div className="flex-1 min-w-0">
              <p className="text-sm leading-relaxed text-gray-800 whitespace-pre-wrap break-words">
                {item.message}
              </p>
              {item.action && (
                <button
                  onClick={() => {
                    item.action?.onClick();
                    removeToast(item.id);
                  }}
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors"
                >
                  {item.action.label}
                  <ChevronRight className="size-3" />
                </button>
              )}
            </div>

            {item.dismissible && (
              <button
                onClick={() => removeToast(item.id)}
                className="shrink-0 rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="关闭"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>,
    document.body
  );
}
