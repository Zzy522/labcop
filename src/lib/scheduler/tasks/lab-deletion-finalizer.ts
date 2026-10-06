import type { ScheduledTask } from '../types';
import { finalizeExpiredLabDeletions } from '@/lib/lab-lifecycle-service';

const task: ScheduledTask = {
  name: 'lab-deletion-finalizer',
  schedule: '15 * * * *',
  description: '每小时完成已超过 7 天等待期的实验室删除',
  runOnStartup: true,
  timeoutMs: 5 * 60 * 1000,
  async handler() {
    const count = await finalizeExpiredLabDeletions();
    if (count > 0) console.log(`[lab-deletion-finalizer] 已完成 ${count} 个实验室删除`);
  },
};

export default task;
