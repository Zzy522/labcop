import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
/**
 * 定时任务调度器 - 主入口
 *
 * ============================================================
 * 选型决策：node-cron（已选定）
 * ============================================================
 *
 * ## 候选方案对比
 *
 * | 维度        | node-cron         | BullMQ            | Vercel Cron       |
 * |------------|-------------------|-------------------|-------------------|
 * | 部署模式    | 进程内            | 独立 worker+Redis | 平台调用 HTTP     |
 * | 外部依赖    | 无                | Redis             | Vercel 平台       |
 * | 运维成本    | 极低              | 高（Redis 持久化）| 低（仅 Vercel）   |
 * | 重试机制    | 需自实现          | 内置              | 平台级            |
 * | 分布式锁    | 需自实现          | 内置              | N/A               |
 * | 任务持久化  | 否                | 是                | 是                |
 * | 适用规模    | 单机 <100 任务    | 分布式            | 单次/天级         |
 *
 * ## 决策理由（选 node-cron）
 *
 * 1. **部署匹配**：项目为 `next start` 自托管单机部署，进程常驻，
 *    node-cron 在进程内运行天然匹配，无需额外组件
 * 2. **零外部依赖**：BullMQ 需引入 Redis，对实验室级项目（单实验室
 *    几十用户）严重过度设计
 * 3. **任务频率需求低**：当前最频繁任务为「通告每 5 分钟扫描」，
 *    node-cron 完全胜任
 * 4. **失败容忍度高**：所有任务保留「懒加载兜底」（如通告发布仍可
 *    由 GET 触发），cron 挂了不影响主流程
 * 5. **Vercel Cron 不适用**：项目未使用 Vercel 平台
 *
 * ## 风险与缓解
 *
 * | 风险                      | 缓解措施                                       |
 * |--------------------------|------------------------------------------------|
 * | 进程重启会丢失正在执行的任务 | 任务设计为幂等，重启后 runOnStartup 补偿        |
 * | 多实例部署会重复执行        | 通过 health 接口暴露状态；未来需要时加分布式锁  |
 * | 任务执行无持久化历史        | 在内存保留最近 50 次执行记录供 health 接口查询  |
 * | 任务异常会污染主进程        | 每个任务 wrapper try/catch，异常只记录不抛出    |
 *
 * ## 当前注册的任务清单
 *
 * 见 `tasks/` 目录下的具体任务定义：
 * - announcement-publisher：通告定时发布（每 5 分钟）
 * - qualification-expiry-scanner：资质到期扫描（每日 09:00）
 * - user-action-log-cleanup：行为日志清理（每日 03:00）
 * - chat-session-cleanup：会话软删除清理（每日 04:00）
 * - user-profile-summarizer：用户画像周期总结（每周日 02:00）
 * - lab-deletion-finalizer：实验室 7 天删除等待期到期处理（每小时）
 *
 * ============================================================
 */

import type { ScheduledTask, SchedulerHealth, TaskRunRecord } from './types';

// node-cron 通过动态 import 引入，避免影响 Edge runtime 打包
// 同时如果未安装依赖，给出明确错误而非启动崩溃
type CronTask = { stop: () => void };
type CronScheduleFn = (
  expression: string,
  fn: () => void,
  options?: { timezone?: string }
) => CronTask;

let cronScheduleFn: CronScheduleFn | null = null;
const activeTasks = new Set<string>();
const registeredTasks: ScheduledTask[] = [];
const cronTasks: CronTask[] = [];
const recentRuns: TaskRunRecord[] = [];
const MAX_RECENT_RUNS = 50;
let startedAt: string | null = null;
let lastError: SchedulerHealth['lastError'] | undefined;

/**
 * 启动调度器，注册所有任务
 *
 * 由 instrumentation.ts 在 server 启动时调用
 */
export async function startScheduler(): Promise<void> {
  if (startedAt) {
    console.warn('[scheduler] 已启动，跳过重复注册');
    return;
  }

  // 动态加载 node-cron（仅 Node.js runtime）
  try {
    const cronModule = await import('node-cron');
    cronScheduleFn = cronModule.schedule as CronScheduleFn;
  } catch (error) {
    console.error('[scheduler] node-cron 未安装，调度器无法启动。请运行: npm install node-cron @types/node-cron');
    throw error;
  }

  startedAt = new Date().toISOString();

  // 动态加载任务定义（避免任务未实现时影响调度器启动）
  const tasks = await loadTaskDefinitions();
  registeredTasks.push(...tasks);

  for (const task of tasks) {
    registerTask(task);
  }

  console.log(`[scheduler] 已注册 ${tasks.length} 个定时任务`);
}

/**
 * 注册单个任务到 cron
 */
function registerTask(task: ScheduledTask): void {
  if (!cronScheduleFn) {
    console.error(`[scheduler] cron 未初始化，无法注册任务: ${task.name}`);
    return;
  }

  const wrappedHandler = () => {
    runTaskWithTracking(task).catch((err) => {
      // 兜底，理论上 runTaskWithTracking 内部已 catch
      console.error(`[scheduler] 任务 ${task.name} 未捕获异常:`, err);
    });
  };

  const cronTask = cronScheduleFn(task.schedule, wrappedHandler, {
    timezone: 'Asia/Shanghai',
  });
  cronTasks.push(cronTask);

  // 启动时立即执行一次（用于补偿漏跑）
  if (task.runOnStartup) {
    console.log(`[scheduler] 任务 ${task.name} runOnStartup 触发`);
    wrappedHandler();
  }
}

/**
 * 任务执行包装：统一记录耗时与状态
 */
async function runTaskWithTracking(task: ScheduledTask): Promise<void> {
  if (activeTasks.has(task.name)) return;
  activeTasks.add(task.name);
  const taskStartedAt = new Date();
  const record: TaskRunRecord = {
    taskName: task.name,
    startedAt: taskStartedAt.toISOString(),
    finishedAt: null,
    success: false,
  };

  const timeoutMs = task.timeoutMs ?? 5 * 60 * 1000;

  try {
    const execution = Promise.resolve().then(() => task.handler()).finally(() => activeTasks.delete(task.name));
    await withTimeout(execution, timeoutMs);
    record.success = true;
    record.finishedAt = new Date().toISOString();
    record.durationMs = Date.now() - taskStartedAt.getTime();
    console.log(`[scheduler] 任务 ${task.name} 执行成功 (${record.durationMs}ms)`);
  } catch (error) {
    record.success = false;
    record.finishedAt = new Date().toISOString();
    record.durationMs = Date.now() - taskStartedAt.getTime();
    record.error = error instanceof Error ? error.message : String(error);
    lastError = {
      taskName: task.name,
      error: record.error,
      at: record.finishedAt,
    };
    console.error(`[scheduler] 任务 ${task.name} 执行失败:`, error);
  } finally {
    // 推入最近执行记录（保留 50 条）
    try {
      const directory = path.join(process.cwd(), 'data', 'scheduler');
      await mkdir(directory, { recursive: true });
      await appendFile(path.join(directory, 'scheduler.ndjson'), JSON.stringify(record) + '\n');
    } catch (error) { console.error('[scheduler] cannot persist run record', error); }
    recentRuns.push(record);
    if (recentRuns.length > MAX_RECENT_RUNS) {
      recentRuns.splice(0, recentRuns.length - MAX_RECENT_RUNS);
    }
  }
}

/**
 * 超时包装器
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`任务超时（${timeoutMs}ms）`));
    }, timeoutMs);
    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * 加载任务定义
 *
 * 任务文件放在 ./tasks/ 目录下，每个文件 default export 一个 ScheduledTask
 * 文件不存在时跳过（不报错），便于渐进式开发
 */
async function loadTaskDefinitions(): Promise<ScheduledTask[]> {
  const tasks: ScheduledTask[] = [];

  // 已实现任务：取消注释即可加载；未实现任务保留注释便于渐进式开发
  const taskLoaders: Array<{ name: string; loader: () => Promise<{ default: ScheduledTask } | ScheduledTask> }> = [
    { name: 'audit-outbox', loader: () => import('./tasks/audit-outbox') },
    { name: 'announcement-publisher', loader: () => import('./tasks/announcement-publisher') },
    { name: 'qualification-expiry-scanner', loader: () => import('./tasks/qualification-expiry-scanner') },
    { name: 'diagnostic-cleanup', loader: () => import('./tasks/diagnostic-cleanup') },
    { name: 'receipt-ocr-processor', loader: () => import('./tasks/receipt-ocr-processor') },
    { name: 'lab-deletion-finalizer', loader: () => import('./tasks/lab-deletion-finalizer') },
    // { name: 'user-action-log-cleanup', loader: () => import('./tasks/user-action-log-cleanup') },
    // { name: 'chat-session-cleanup', loader: () => import('./tasks/chat-session-cleanup') },
    { name: 'user-profile-summarizer', loader: () => import('./tasks/user-profile-summarizer') },
  ];

  for (const { name, loader } of taskLoaders) {
    try {
      const mod = await loader();
      const task = (mod as { default?: ScheduledTask }).default ?? (mod as ScheduledTask);
      if (task && typeof task.handler === 'function') {
        tasks.push(task);
      } else {
        console.warn(`[scheduler] 任务 ${name} 未导出有效的 ScheduledTask`);
      }
    } catch (error) {
      console.warn(`[scheduler] 任务 ${name} 加载失败，跳过:`, error);
    }
  }

  return tasks;
}

/**
 * 获取调度器健康状态
 * 用于 /api/cron/health 接口
 */
export function getSchedulerHealth(): SchedulerHealth {
  return {
    startedAt: startedAt ?? new Date().toISOString(),
    uptimeMs: startedAt ? Date.now() - new Date(startedAt).getTime() : 0,
    registeredTasks: registeredTasks.map((t) => ({
      name: t.name,
      schedule: t.schedule,
      description: t.description,
    })),
    recentRuns: recentRuns.slice(-MAX_RECENT_RUNS),
    lastError,
  };
}

/**
 * 手动触发指定任务（用于运维或测试）
 */
export async function triggerTask(taskName: string): Promise<boolean> {
  const task = registeredTasks.find((t) => t.name === taskName);
  if (!task) {
    return false;
  }
  await runTaskWithTracking(task);
  return true;
}

/**
 * 关闭调度器（仅用于测试或优雅关闭）
 */
export function stopScheduler(): void {
  for (const cronTask of cronTasks) {
    try {
      cronTask.stop();
    } catch {
      // ignore
    }
  }
  cronTasks.length = 0;
  registeredTasks.length = 0;
  recentRuns.length = 0;
  startedAt = null;
  lastError = undefined;
  console.log('[scheduler] 已停止');
}
