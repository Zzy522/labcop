import { durableWriteFile } from '@/lib/durable-file';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

const directory = path.join(process.cwd(), 'data', 'audit-outbox');

// Legacy non-transactional callers use a durable journal if the DB write fails.
// New business operations pass their transaction and must roll back with their audit.
export async function queueAudit(data: Prisma.AuditLogUncheckedCreateInput & { id: string }) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await durableWriteFile(path.join(directory, `${data.id}.json`), Buffer.from(JSON.stringify(data)));
}

export async function flushAuditOutbox() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(directory, name);
    const data = JSON.parse(await readFile(file, 'utf8')) as Prisma.AuditLogUncheckedCreateInput & { id: string };
    await prisma.auditLog.upsert({ where: { id: data.id }, create: data, update: {} });
    await unlink(file);
  }
}
