import { Badge } from '@/components/ui/badge';
import type { RiskLevel } from '@/types';

const RISK_LEVEL_CONFIG: Record<RiskLevel, { label: string; className: string }> = {
  LOW: { label: '低风险', className: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800' },
  HIGH: { label: '高风险', className: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800' },
};

interface RiskLevelBadgeProps {
  level: string;
  showLabel?: boolean;
}

export function RiskLevelBadge({ level, showLabel = true }: RiskLevelBadgeProps) {
  const config = RISK_LEVEL_CONFIG[level as RiskLevel] ?? RISK_LEVEL_CONFIG.LOW;
  return (
    <Badge variant="outline" className={config.className}>
      {showLabel ? config.label : level}
    </Badge>
  );
}
