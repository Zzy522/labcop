'use client';

import { Drawer as ArcoDrawer } from '@arco-design/web-react';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as React from 'react';

function Sheet({ open, onOpenChange, children, ...props }: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <ArcoDrawer
      visible={open}
      onCancel={() => onOpenChange?.(false)}
      footer={null}
      closable={false}
      {...props}
    >
      {children}
    </ArcoDrawer>
  );
}

function SheetTrigger({ children, ...props }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function SheetClose({ children, ...props }: { children?: React.ReactNode }) {
  return <button type="button" {...props}>{children}</button>;
}

function SheetPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function SheetOverlay({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)} {...props}>
      {children}
    </div>
  );
}

function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-0.5 p-4", className)} {...props} />;
}

function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />;
}

function SheetTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-base font-medium", className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm text-gray-500", className)} {...props} />;
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
