'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

// Use native HTML input to maintain full compatibility with react-hook-form register()
// and standard React input event handlers. Arco Input's onChange signature (value, e)
// is incompatible with standard onChange handlers.
export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-sm shadow-slate-950/[0.02]',
          'transition-all duration-200 placeholder:text-gray-400',
          'hover:border-slate-300 hover:shadow-sm',
          'focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/10',
          'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';

export { Input as default };
