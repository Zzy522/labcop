'use client';

import { Select as ArcoSelect } from '@arco-design/web-react';
import { cn } from '@/lib/utils';

interface SelectOption {
  value: string;
  label: string;
}

interface ArcoSelectAdapterProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  options: SelectOption[];
  className?: string;
  style?: React.CSSProperties;
  allowClear?: boolean;
}

/**
 * Arco Select 适配器 - 将 shadcn Select 的复合组件式用法
 * 简化为 <Select value={} onChange={} options={} /> 单组件
 */
export function Select({ value, onChange, placeholder, options, className, style, allowClear = true }: ArcoSelectAdapterProps) {
  return (
    <ArcoSelect
      value={value || undefined}
      onChange={(val) => onChange?.(val as string ?? '')}
      placeholder={placeholder}
      allowClear={allowClear}
      className={cn("", className)}
      style={style}
    >
      {options.map((opt) => (
        <ArcoSelect.Option key={opt.value} value={opt.value}>
          {opt.label}
        </ArcoSelect.Option>
      ))}
    </ArcoSelect>
  );
}
