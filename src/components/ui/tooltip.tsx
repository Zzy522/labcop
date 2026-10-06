'use client';

import { Tooltip as ArcoTooltip } from '@arco-design/web-react';
import { cn } from '@/lib/utils';
import * as React from 'react';

function TooltipProvider({ delay = 0, ...props }: { delay?: number; children?: React.ReactNode }) {
  return <>{props.children}</>;
}

function Tooltip({ children, ...props }: { children?: React.ReactNode }) {
  return <ArcoTooltip {...props}>{children}</ArcoTooltip>;
}

function TooltipTrigger({ children, render, ...props }: {
  children?: React.ReactNode;
  render?: React.ReactElement;
  side?: string;
}) {
  // ArcoTooltip wraps children directly as trigger
  if (render) {
    return React.cloneElement(render, props);
  }
  return <>{children}</>;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  side?: string;
  sideOffset?: number;
  align?: string;
  alignOffset?: number;
}) {
  // Content is handled by ArcoTooltip internally
  return <>{children}</>;
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
