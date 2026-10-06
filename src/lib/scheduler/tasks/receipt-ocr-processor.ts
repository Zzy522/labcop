import type { ScheduledTask } from '@/lib/scheduler/types';
import { processQueuedReceiptDocuments } from '@/lib/services/receipt-ocr.service';

const task: ScheduledTask = {
  name: 'receipt-ocr-processor',
  schedule: '* * * * *',
  description: '处理持久化的票据 OCR 队列，并恢复异常中断任务',
  runOnStartup: true,
  timeoutMs: 4 * 60 * 1000,
  handler: () => processQueuedReceiptDocuments(3),
};

export default task;
