'use client';

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import * as React from 'react';

interface TabItem {
  key: string;
  label: React.ReactNode;
  content: React.ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  activeKey?: string;
  onChange?: (key: string) => void;
  defaultActiveKey?: string;
  items: TabItem[];
  tabBarExtra?: React.ReactNode;
  className?: string;
  tabPosition?: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * 纯 Tailwind Tabs 组件 — 不依赖 ArcoDesign，避免 CSS 冲突
 */
export function Tabs({ activeKey, onChange, defaultActiveKey, items, tabBarExtra, className, tabPosition = 'top' }: TabsProps) {
  const [internalActive, setInternalActive] = useState(defaultActiveKey ?? items[0]?.key ?? '');
  const currentActive = activeKey ?? internalActive;

  const handleTabClick = useCallback((key: string) => {
    if (activeKey === undefined) {
      setInternalActive(key);
    }
    onChange?.(key);
  }, [activeKey, onChange]);

  const activeItem = items.find((item) => item.key === currentActive) ?? items[0];

  // 水平布局（top/bottom）
  if (tabPosition === 'top' || tabPosition === 'bottom') {
    return (
      <div className={cn('w-full', className)}>
        <div className={cn('flex gap-1 border-gray-200', tabPosition === 'top' ? 'border-b' : 'border-t')}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={item.disabled}
              onClick={() => handleTabClick(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer',
                tabPosition === 'top' ? 'border-b-2 -mb-px' : 'border-t-2 -mt-px',
                item.key === currentActive
                  ? 'border-teal-600 text-teal-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                item.disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
              )}
            >
              {item.label}
            </button>
          ))}
          {tabBarExtra && <div className="ml-1 flex items-center pb-1">{tabBarExtra}</div>}
        </div>
        <div className="pt-4">
          {activeItem?.content}
        </div>
      </div>
    );
  }

  // 垂直布局（left/right）
  return (
    <div className={cn('flex w-full', tabPosition === 'right' && 'flex-row-reverse', className)}>
      <div className={cn('flex flex-col gap-1 border-gray-200 py-2', tabPosition === 'left' ? 'border-r pr-4' : 'border-l pl-4')}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            disabled={item.disabled}
            onClick={() => handleTabClick(item.key)}
            className={cn(
              'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors rounded-md text-left cursor-pointer',
              item.key === currentActive
                ? 'bg-teal-50 text-teal-600'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
              item.disabled && 'opacity-50 cursor-not-allowed pointer-events-none'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="flex-1 pt-2">
        {activeItem?.content}
      </div>
    </div>
  );
}
