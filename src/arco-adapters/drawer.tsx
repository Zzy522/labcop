'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as React from 'react';

interface DrawerProps {
  visible?: boolean;
  onCancel?: () => void;
  placement?: 'left' | 'right' | 'top' | 'bottom';
  width?: number | string;
  height?: number | string;
  closable?: boolean;
  footer?: React.ReactNode;
  title?: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  className?: string;
  maskClosable?: boolean;
  children?: React.ReactNode;
}

/**
 * 纯 Tailwind Drawer 适配器 — 不依赖 ArcoDesign，避免 StrictMode 下的 findDOMNode 警告。
 * 使用 createPortal + CSS transform 实现平滑滑入/滑出动画。
 */
export function Drawer({
  visible = false,
  onCancel,
  placement = 'right',
  width = 400,
  height,
  closable = true,
  footer,
  title,
  style,
  bodyStyle,
  className,
  maskClosable = true,
  children,
}: DrawerProps) {
  // 延迟挂载：首次 visible=true 后才渲染 portal，关闭后保留 DOM 以播放退出动画
  const [mounted, setMounted] = useState(false);
  // 退出动画态：visible=false 时仍渲染一帧以播放滑出动画
  const [rendering, setRendering] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      // 下一帧再设置 rendering=true，确保进入动画生效
      const raf = requestAnimationFrame(() => setRendering(true));
      return () => cancelAnimationFrame(raf);
    }
    // visible=false：开始退出动画，动画结束后卸载
    setRendering(false);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => setMounted(false), 300);
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
    };
  }, [visible]);

  // ESC 关闭 + 锁定背景滚动
  useEffect(() => {
    if (!rendering) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && maskClosable) onCancel?.();
    };
    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [rendering, maskClosable, onCancel]);

  if (!mounted || typeof window === 'undefined') return null;

  const isHorizontal = placement === 'left' || placement === 'right';

  const panelStyle: React.CSSProperties = {
    ...style,
    ...(isHorizontal ? { width: typeof width === 'number' ? `${width}px` : width } : {}),
    ...(!isHorizontal ? { height: typeof (height ?? 400) === 'number' ? `${height ?? 400}px` : (height ?? 400) } : {}),
  };

  const placementClass: Record<string, string> = {
    left: 'left-0 top-0 h-full',
    right: 'right-0 top-0 h-full',
    top: 'left-0 top-0 w-full',
    bottom: 'left-0 bottom-0 w-full',
  };

  const transformClass: Record<string, string> = {
    left: rendering ? 'translate-x-0' : '-translate-x-full',
    right: rendering ? 'translate-x-0' : 'translate-x-full',
    top: rendering ? 'translate-y-0' : '-translate-y-full',
    bottom: rendering ? 'translate-y-0' : 'translate-y-full',
  };

  return createPortal(
    <div className={cn('fixed inset-0 z-50', !rendering && 'pointer-events-none')}>
      {/* 遮罩层 */}
      <div
        className={cn(
          'absolute inset-0 bg-black/40 backdrop-blur-[1px] transition-opacity duration-300',
          rendering ? 'opacity-100' : 'opacity-0'
        )}
        onClick={() => {
          if (maskClosable) onCancel?.();
        }}
      />
      {/* 抽屉面板 */}
      <div
        className={cn(
          'absolute flex flex-col bg-white shadow-2xl transition-transform duration-300 ease-out',
          placementClass[placement],
          transformClass[placement],
          className
        )}
        style={panelStyle}
        role="dialog"
        aria-modal="true"
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="text-base font-semibold text-gray-800">{title}</div>
            {closable && (
              <button
                type="button"
                onClick={() => onCancel?.()}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="关闭"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        )}
        <div className="flex-1 overflow-auto" style={bodyStyle}>
          {children}
        </div>
        {footer && (
          <div className="shrink-0 border-t border-gray-100 px-4 py-3">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}
