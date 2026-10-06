'use client';

import { Avatar as ArcoAvatar } from '@arco-design/web-react';
import { cn } from '@/lib/utils';
import * as React from 'react';

function Avatar({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex size-8 shrink-0 rounded-full select-none",
        className
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      className={cn("aspect-square size-full rounded-full object-cover", className)}
      {...props}
    />
  );
}

function AvatarFallback({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex size-full items-center justify-center rounded-full bg-gray-100 text-sm text-gray-500",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function AvatarBadge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-[rgb(var(--primary-6))] text-white ring-2 ring-white select-none",
        className
      )}
      {...props}
    />
  );
}

function AvatarGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex -space-x-2", className)} {...props} />
  );
}

function AvatarGroupCount({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm text-gray-500 ring-2 ring-white",
        className
      )}
      {...props}
    />
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarBadge,
};
