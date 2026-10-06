'use client';

import { Select as ArcoSelect } from '@arco-design/web-react';
import { cn } from '@/lib/utils';
import * as React from 'react';

// We export Arco Select directly since it's API-compatible enough
// Pages need to be updated to use Arco's API (onChange instead of onValueChange)

// Re-export Arco Select with compatible wrapper
const Select = ArcoSelect;

// These are kept as no-ops / passthrough for backward compat during migration
// In practice, pages should use Arco's <Select.Option> directly

function SelectTrigger({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { size?: string }) {
  return <div className={cn("", className)} {...props}>{children}</div>;
}

function SelectContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("", className)} {...props}>{children}</div>;
}

function SelectValue({ className, placeholder, ...props }: React.HTMLAttributes<HTMLSpanElement> & { placeholder?: string }) {
  return <span className={cn("", className)} {...props} />;
}

const SelectItem = ArcoSelect.Option;

function SelectGroup({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{children}</div>;
}

function SelectLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-1.5 py-1 text-xs text-gray-500", className)} {...props} />;
}

function SelectSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("-mx-1 my-1 h-px bg-gray-200", className)} {...props} />;
}

function SelectScrollUpButton({ ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return null;
}

function SelectScrollDownButton({ ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return null;
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
