'use client';

import { Modal as ArcoModal } from '@arco-design/web-react';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as React from 'react';

// Dialog root: maps to Arco Modal
function Dialog({ open, onOpenChange, children, ...props }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <ArcoModal
      visible={open}
      onCancel={() => onOpenChange?.(false)}
      footer={null}
      closable={false}
      maskClosable={false}
      unmountOnExit
      {...props}
    >
      {children}
    </ArcoModal>
  );
}

// DialogTrigger: for trigger-based usage
function DialogTrigger({ children, render, ...props }: {
  children?: React.ReactNode;
  render?: React.ReactElement;
  onClick?: () => void;
}) {
  // If render prop provided, clone it with onClick
  if (render) {
    return React.cloneElement(render, props);
  }
  return <>{children}</>;
}

// DialogClose: closes dialog context
function DialogClose({ children, render, ...props }: {
  children?: React.ReactNode;
  render?: React.ReactElement;
}) {
  if (render) {
    return React.cloneElement(render, props);
  }
  return <button type="button" {...props}>{children}</button>;
}

function DialogPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DialogOverlay({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 text-sm text-gray-900 outline-none",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function DialogFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { showCloseButton?: boolean }) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("text-base leading-none font-semibold", className)} {...props} />
  );
}

function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("text-sm text-gray-500", className)} {...props} />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
