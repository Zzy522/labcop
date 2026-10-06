import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-16 w-full rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm",
        "transition-colors placeholder:text-gray-400",
        "focus:border-[rgb(var(--primary-6))] focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
