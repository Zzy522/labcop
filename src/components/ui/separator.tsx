'use client';

import { cn } from "@/lib/utils";
import * as React from "react";

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { orientation?: string }) {
  return (
    <div
      className={cn(
        "shrink-0 bg-gray-200",
        orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch",
        className
      )}
      {...props}
    />
  );
}

export { Separator };
