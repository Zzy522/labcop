'use client';

import { Dropdown as ArcoDropdown } from '@arco-design/web-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import * as React from 'react';

function DropdownMenu({ children, ...props }: {
  children?: React.ReactNode;
}) {
  return <>{children}</>;
}

function DropdownMenuPortal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function DropdownMenuTrigger({ children, render, ...props }: {
  children?: React.ReactNode;
  render?: React.ReactElement;
}) {
  if (render) {
    return React.cloneElement(render, props);
  }
  return <>{children}</>;
}

function DropdownMenuContent({
  className,
  children,
  align = "start",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  align?: string;
  alignOffset?: number;
  side?: string;
  sideOffset?: number;
}) {
  return (
    <div
      className={cn(
        "z-50 min-w-32 overflow-hidden rounded-lg bg-white p-1 text-gray-900 shadow-lg ring-1 ring-gray-200",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DropdownMenuGroup({ children, ...props }: { children?: React.ReactNode }) {
  return <div {...props}>{children}</div>;
}

function DropdownMenuLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  return <div className={cn("px-1.5 py-1 text-xs font-medium text-gray-500", className)} {...props} />;
}

function DropdownMenuItem({
  className,
  onClick,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  inset?: boolean;
  variant?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm select-none",
        "hover:bg-gray-100",
        className
      )}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  );
}

function DropdownMenuSub({ children, ...props }: { children?: React.ReactNode }) {
  return <div {...props}>{children}</div>;
}

function DropdownMenuSubTrigger({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  return (
    <div className={cn("flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100", className)} {...props}>
      {children}
    </div>
  );
}

function DropdownMenuSubContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("z-50 min-w-[96px] rounded-lg bg-white p-1 shadow-lg ring-1 ring-gray-200", className)} {...props}>
      {children}
    </div>
  );
}

function DropdownMenuCheckboxItem({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { checked?: boolean; inset?: boolean }) {
  return (
    <div className={cn("relative flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100", className)} {...props}>
      {children}
    </div>
  );
}

function DropdownMenuRadioGroup({ children, ...props }: { children?: React.ReactNode }) {
  return <div {...props}>{children}</div>;
}

function DropdownMenuRadioItem({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }) {
  return (
    <div className={cn("relative flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-gray-100", className)} {...props}>
      {children}
    </div>
  );
}

function DropdownMenuSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("-mx-1 my-1 h-px bg-gray-200", className)} {...props} />;
}

function DropdownMenuShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ml-auto text-xs tracking-widest text-gray-400", className)} {...props} />;
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
