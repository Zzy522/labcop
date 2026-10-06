'use client';

import { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import * as React from 'react';

interface TooltipProps {
  content: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  mini?: boolean;
  children: React.ReactElement;
  className?: string;
}

interface Coords {
  left: number;
  top: number;
}

/**
 * 纯 Tailwind Tooltip 适配器 — 不依赖 ArcoDesign，避免 StrictMode 下的 findDOMNode 警告。
 * 使用 createPortal 渲染到 body，避免父级 overflow 裁剪；通过 getBoundingClientRect 定位。
 */
export function Tooltip({ content, position = 'top', mini = false, children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<Coords>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tooltipXOffset = 8;
    const tooltipYOffset = 8;
    let left: number;
    let top: number;
    switch (position) {
      case 'right':
        left = rect.right + tooltipXOffset;
        top = rect.top + rect.height / 2;
        break;
      case 'left':
        left = rect.left - tooltipXOffset;
        top = rect.top + rect.height / 2;
        break;
      case 'bottom':
        left = rect.left + rect.width / 2;
        top = rect.bottom + tooltipYOffset;
        break;
      case 'top':
      default:
        left = rect.left + rect.width / 2;
        top = rect.top - tooltipYOffset;
        break;
    }
    setCoords({ left, top });
  }, [position]);

  const handleMouseEnter = useCallback(() => {
    setVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
  }, []);

  // visible 变为 true 时同步计算坐标（layoutEffect 避免首帧闪烁）
  useLayoutEffect(() => {
    if (!visible) return;
    updatePosition();
  }, [visible, updatePosition]);

  // 克隆子元素，注入 ref 和事件
  const child = React.Children.only(children) as React.ReactElement<{
    ref?: React.Ref<HTMLElement>;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
  }>;
  const clonedChild = React.cloneElement(child, {
    ref: (node: HTMLElement) => {
      triggerRef.current = node;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      handleMouseEnter();
      child.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      handleMouseLeave();
      child.props.onMouseLeave?.(e);
    },
  });

  const transformClass: Record<string, string> = {
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2',
    left: '-translate-x-full -translate-y-1/2',
    right: '-translate-y-1/2',
  };

  return (
    <>
      {clonedChild}
      {visible &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            role="tooltip"
            className={cn(
              'fixed z-[100] whitespace-nowrap rounded-md bg-gray-900/95 px-2.5 py-1 text-xs font-medium text-white shadow-lg ring-1 ring-black/5',
              mini && 'px-2 py-0.5 text-[11px]',
              transformClass[position],
              className
            )}
            style={{ left: coords.left, top: coords.top }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
