'use client';

import { cn } from '@/lib/utils';
import * as React from 'react';

// Re-export same interface as shadcn Table but keep simple HTML table structure
// ArcoTable is config-driven and would require significant page refactoring
// So we keep the HTML table approach with Arco-inspired styling

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.03]">
      <table
        className={cn("w-full min-w-max caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn("bg-slate-50/90 [&_tr]:border-b [&_tr]:border-slate-200", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn("border-t bg-gray-50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-slate-100 transition-colors hover:bg-teal-50/40",
        className
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-11 px-3 !text-center align-middle font-semibold whitespace-nowrap text-slate-600",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      className={cn("px-3 py-3 !text-center align-middle whitespace-nowrap", className)}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      className={cn("mt-4 text-sm text-gray-500", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
