'use client';

import { Modal as ArcoModal } from '@arco-design/web-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import * as React from 'react';

interface ArcoDialogAdapterProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  width?: number;
}

/**
 * Arco Dialog 适配器 - 将 shadcn Dialog 的复合组件式用法
 * 简化为 <Dialog open={} onOpenChange={} title={} footer={}>content</Dialog>
 */
export function Dialog({ open, onOpenChange, title, description, children, footer, className, width = 520 }: ArcoDialogAdapterProps) {
  return (
    <ArcoModal
      visible={open}
      onCancel={() => onOpenChange?.(false)}
      title={title}
      footer={footer}
      closable={true}
      maskClosable={false}
      unmountOnExit
      className={cn("", className)}
      style={{ width }}
    >
      {description && (
        <div className="mb-3 text-sm text-gray-500">{description}</div>
      )}
      {children}
    </ArcoModal>
  );
}
