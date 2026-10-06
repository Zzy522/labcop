'use client';

import { Switch as ArcoSwitch } from '@arco-design/web-react';
import { cn } from '@/lib/utils';

function Switch({
  className,
  checked,
  onCheckedChange,
  ...props
}: {
  className?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  defaultChecked?: boolean;
  disabled?: boolean;
  size?: 'default' | 'small';
}) {
  return (
    <ArcoSwitch
      checked={checked}
      onChange={(val) => onCheckedChange?.(val)}
      className={cn("", className)}
      {...props}
    />
  );
}

export { Switch };
