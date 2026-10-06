/**
 * 定时任务调度 - 类型定义
 *
 * @module scheduler/types
 */

/**
 * 定时任务定义
 *
 * 设计原则：
 * - 每个任务有唯一 name，便于日志追踪与健康检查
 * - schedule 使用标准 cron 表达式（5 段：分 时 日 月 周）
 * - 任务函数必须自行 try/catch，失败由 onTaskError 统一记录
 * - 任务可声明 runOnStartup，启动时立即执行一次（用于补偿漏跑）
 */
export interface ScheduledTask {
  /** 任务唯一标识（用于日志、健康检查、手动触发） */
  name: string;
  /** cron 表达式，5 段：分 时 日 月 周（如 "0 2 * * 0"=每周日 02:00） */
  schedule: string;
  /** 任务执行函数（必须自行 try/catch 或抛出由 wrapper 兜底） */
  handler: () => Promise<void>;
  /** 启动时立即执行一次（默认 false，用于补偿宕机期间漏跑） */
  runOnStartup?: boolean;
  /** 任务超时时间（毫秒，默认 5 分钟） */
  timeoutMs?: number;
  /** 任务描述（用于 /api/cron/health 健康检查展示） */
  description?: string;
}

/**
 * 任务执行状态记录
 * 用于 /api/cron/health 接口暴露调度器运行状态
 */
export interface TaskRunRecord {
  taskName: string;
  startedAt: string; // ISO
  finishedAt: string | null; // ISO，null 表示运行中
  success: boolean;
  error?: string;
  durationMs?: number;
}

/**
 * 调度器健康状态
 */
export interface SchedulerHealth {
  startedAt: string; // ISO
  uptimeMs: number;
  registeredTasks: Array<{
    name: string;
    schedule: string;
    description?: string;
  }>;
  recentRuns: TaskRunRecord[]; // 最近 50 次执行记录
  lastError?: {
    taskName: string;
    error: string;
    at: string;
  };
}
