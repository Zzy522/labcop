'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** HTML button type (submit, button, reset) */
  htmlType?: 'submit' | 'button' | 'reset';
}

const variantClass: Record<ButtonVariant, string> = {
  default: 'border border-teal-700 bg-teal-700 text-white shadow-sm shadow-teal-900/15 hover:border-teal-600 hover:bg-teal-600 hover:shadow-md hover:shadow-teal-900/15',
  destructive: 'bg-red-600 text-white hover:bg-red-500 border-red-600 shadow-sm shadow-red-600/20',
  outline: 'border border-slate-200 bg-white text-slate-700 shadow-sm shadow-slate-950/[0.03] hover:border-teal-300 hover:bg-teal-50/60 hover:text-teal-700',
  secondary: 'border border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200',
  ghost: 'border border-transparent text-slate-600 hover:bg-teal-50 hover:text-teal-700',
  link: 'text-teal-600 hover:text-teal-500 underline-offset-4',
};

const sizeClass: Record<ButtonSize, string> = {
  'icon-sm': 'h-7 min-w-[28px] w-7 p-0',
  sm: 'h-9 px-3 text-xs',
  default: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
  icon: 'h-10 min-w-[40px] w-10 p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'default', className, htmlType, type, children, disabled, ...props }, ref) => {
    const buttonType = htmlType || (type as 'submit' | 'button' | 'reset') || 'button';

    return (
      <button
        ref={ref}
        type={buttonType}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/20',
          'disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
          variantClass[variant],
          sizeClass[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

export { Button as default };
