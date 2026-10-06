import { Badge } from '@/components/ui/badge';

// 设备状态映射
const DEVICE_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  IDLE: { label: '空闲', className: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800/30 dark:text-gray-400' },
  IN_USE: { label: '使用中', className: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400' },
  MAINTENANCE: { label: '维护中', className: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400' },
  DISABLED: { label: '禁止使用', className: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400' },
};

// 领用状态映射
const REQUISITION_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: '待处理', className: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800/30 dark:text-gray-400' },
  APPROVED: { label: '已通过', className: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400' },
  NEEDS_CONFIRM: { label: '待确认', className: 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400' },
  BLOCKED: { label: '已阻断', className: 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-400' },
  REJECTED: { label: '已拒绝', className: 'bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400' },
};

// 风险事件级别映射
const RISK_LEVEL_CONFIG: Record<string, { label: string; className: string }> = {
  INFO: { label: '提示', className: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400' },
  WARNING: { label: '警告', className: 'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400' },
  CRITICAL: { label: '严重', className: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-400' },
};

// 试剂操作类型映射
const REAGENT_ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  STOCK_IN: { label: '入库', className: 'bg-green-100 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400' },
  STOCK_OUT: { label: '出库', className: 'bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400' },
  ADJUST: { label: '调整', className: 'bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400' },
  ARCHIVE: { label: '归档', className: 'bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800/30 dark:text-gray-400' },
};

// 通用配置映射
const CONFIG_MAPS: Record<string, Record<string, { label: string; className: string }>> = {
  device: DEVICE_STATUS_CONFIG,
  requisition: REQUISITION_STATUS_CONFIG,
  riskLevel: RISK_LEVEL_CONFIG,
  reagentAction: REAGENT_ACTION_CONFIG,
};

interface StatusBadgeProps {
  type: keyof typeof CONFIG_MAPS;
  status: string;
  fallback?: string;
}

export function StatusBadge({ type, status, fallback }: StatusBadgeProps) {
  const config = CONFIG_MAPS[type]?.[status];
  if (!config) {
    return fallback ? <Badge variant="outline">{fallback}</Badge> : null;
  }
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}

// 便捷导出
export { DEVICE_STATUS_CONFIG, REQUISITION_STATUS_CONFIG, RISK_LEVEL_CONFIG, REAGENT_ACTION_CONFIG };
