'use client';

import { Progress as ArcoProgress } from '@arco-design/web-react';
import { cn } from '@/lib/utils';
import * as React from 'react';

function Progress({
  className,
  value,
  ...props
}: {
  className?: string;
  value?: number;
  children?: React.ReactNode;
}) {
  return (
    <ArcoProgress
      percent={value ?? 0}
      showText={false}
      strokeWidth={8}
      className={cn("", className)}
      {...props}
    />
  );
}

function ProgressTrack({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("relative flex h-1 w-full items-center overflow-hidden rounded-full bg-gray-200", className)}
      {...props}
    />
  );
}

function ProgressIndicator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("h-full bg-[rgb(var(--primary-6))] transition-all", className)}
      {...props}
    />
  );
}

function ProgressLabel({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-sm font-medium", className)} {...props} />;
}

function ProgressValue({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ml-auto text-sm text-gray-500 tabular-nums", className)} {...props} />;
}

export {
  Progress,
  ProgressTrack,
  ProgressIndicator,
  ProgressLabel,
  ProgressValue,
};
