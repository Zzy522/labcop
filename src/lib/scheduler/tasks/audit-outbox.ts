import { flushAuditOutbox } from '@/lib/audit-outbox';
import type { ScheduledTask } from '../types';

export default {
  name: 'audit-outbox', schedule: '* * * * *', runOnStartup: true,
  description: '重放已持久保存但尚未入库的审计记录', handler: flushAuditOutbox,
} satisfies ScheduledTask;
