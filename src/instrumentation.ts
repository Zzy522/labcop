/**
 * Next.js Instrumentation 钩子
 *
 * 在 server 启动时执行一次（next dev / next start 均生效）。
 * 用于注册定时任务调度器，确保 node-cron 任务在常驻进程中运行。
 *
 * 选型决策（详见 src/lib/scheduler/README.md）：
 * - 采用 node-cron（轻量、零外部依赖、与 Prisma 共享连接池）
 * - 不采用 BullMQ（需 Redis，对实验室级项目过度）
 * - 不采用 Vercel Cron（项目为自托管 next start 部署）
 *
 * 注意：
 * 1. 此文件只在 Node.js runtime 执行，不会进入 Edge runtime
 * 2. 仅在 server 启动时注册一次，HMR 期间不会重复注册（通过 isRegistered 守卫）
 * 3. 任务执行失败不影响主进程，由 scheduler 内部 try/catch 兜底
 */
export async function register(): Promise<void> {
  // 正向运行时分支让打包器排除 Edge 不支持的调度器及 Node 依赖。
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (globalThis.__SCHEDULER_REGISTERED__) return;
    globalThis.__SCHEDULER_REGISTERED__ = true;
    try {
      const { startScheduler } = await import('@/lib/scheduler');
      await startScheduler();
      console.log('[instrumentation] 定时任务调度器已启动');
    } catch (error) {
      console.error('[instrumentation] 调度器启动失败:', error);
    }
  }
}

// 全局守卫变量类型声明（避免 TS 报错）
declare global {
  // eslint-disable-next-line no-var
  var __SCHEDULER_REGISTERED__: boolean | undefined;
}
