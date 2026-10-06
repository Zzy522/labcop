'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import * as React from 'react';

interface DropdownItem {
  key: string;
  label: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

interface DropdownMenuProps {
  items: DropdownItem[];
  children?: React.ReactNode;
  trigger?: React.ReactNode;
  triggerVariant?: 'default' | 'outline' | 'primary';
  triggerContent?: React.ReactNode;
  position?: 'top' | 'tl' | 'tr' | 'bottom' | 'bl' | 'br';
}

/**
 * 纯 Tailwind DropdownMenu 组件 — 不依赖 ArcoDesign，避免 CSS 冲突
 * 使用 React Portal 渲染到 body，避免父级 overflow:hidden 裁切菜单
 */
export function DropdownMenu({ items, children, trigger, position = 'bottom' }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 计算菜单位置（基于触发器的 boundingRect）
  const computePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const menuWidth = 160; // min-w-[160px]
    let top = 0;
    let left = 0;

    // 垂直方向
    if (position === 'top' || position === 'tl' || position === 'tr') {
      top = rect.top - 4; // 向上弹出，留 4px 间距；菜单会通过 transform 自下而上展开
    } else {
      top = rect.bottom + 4; // 向下弹出
    }

    // 水平方向
    if (position === 'tr' || position === 'br') {
      left = rect.right - menuWidth;
    } else {
      left = rect.left;
    }

    // 边界保护：避免超出视口
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (left < 8) left = 8;
    if (left + menuWidth > viewportWidth - 8) left = viewportWidth - menuWidth - 8;
    if (top < 8) top = 8;
    if (top > viewportHeight - 8) top = viewportHeight - 8;

    setMenuPos({ top, left });
  }, [position]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    const target = e.target as Node;
    if (
      containerRef.current &&
      !containerRef.current.contains(target) &&
      menuRef.current &&
      !menuRef.current.contains(target)
    ) {
      setOpen(false);
    }
  }, []);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
  }, []);

  const handleScrollOrResize = useCallback(() => {
    if (open) {
      computePosition();
      // 滚动时关闭菜单，避免跟随不平滑
      setOpen(false);
    }
  }, [open, computePosition]);

  useEffect(() => {
    if (open) {
      computePosition();
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      window.addEventListener('scroll', handleScrollOrResize, true);
      window.addEventListener('resize', handleScrollOrResize);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open, handleClickOutside, handleEscape, handleScrollOrResize, computePosition]);

  const handleItemClick = (item: DropdownItem) => {
    if (item.disabled) return;
    item.onClick?.();
    setOpen(false);
  };

  const isUpward = position === 'top' || position === 'tl' || position === 'tr';
  const isRight = position === 'tr' || position === 'br';

  return (
    <>
      <div ref={containerRef} className="relative inline-block">
        {/* 触发器 */}
        <div onClick={() => setOpen((v) => !v)}>
          {trigger || children}
        </div>
      </div>

      {/* 下拉菜单：通过 Portal 渲染到 body，避免父级 overflow 裁切 */}
      {open && menuPos && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className={cn(
            'fixed z-[9999] min-w-[160px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg',
            isUpward && 'origin-bottom'
          )}
          style={{
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`,
            // 向上展开时，以菜单底部为锚点定位
            ...(isUpward ? { transform: 'translateY(-100%)' } : {}),
            ...(isRight ? {} : {}),
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              onClick={() => handleItemClick(item)}
              className={cn(
                'flex w-full items-center px-3 py-2 text-left text-sm transition-colors',
                item.disabled
                  ? 'cursor-not-allowed text-gray-300'
                  : 'cursor-pointer text-gray-700 hover:bg-teal-50 hover:text-teal-600'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
