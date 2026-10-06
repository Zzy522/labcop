import { durableWriteFile } from '@/lib/durable-file';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const RECEIPT_STORAGE_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'receipts');
const STORED_PREFIX = 'data/receipts/';

function extensionFromName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return extension.length <= 8 ? extension : '';
}

export async function saveReceiptFile(file: File): Promise<string> {
  await mkdir(RECEIPT_STORAGE_ROOT, { recursive: true });
  const storedName = `${crypto.randomUUID()}${extensionFromName(file.name)}`;
  const absolutePath = path.join(RECEIPT_STORAGE_ROOT, storedName);
  await durableWriteFile(absolutePath, Buffer.from(await file.arrayBuffer()));
  return `${STORED_PREFIX}${storedName}`;
}

export function resolveReceiptPath(storedPath: string): string {
  const normalized = storedPath.replace(/\\/g, '/');
  if (!normalized.startsWith(STORED_PREFIX)) {
    throw new Error('该记录没有可用的原始票据文件');
  }
  const absolutePath = path.resolve(/* turbopackIgnore: true */ process.cwd(), normalized);
  const allowedPrefix = `${RECEIPT_STORAGE_ROOT}${path.sep}`;
  if (!absolutePath.startsWith(allowedPrefix)) {
    throw new Error('票据文件路径无效');
  }
  return absolutePath;
}

export async function readReceiptFile(storedPath: string): Promise<Buffer> {
  return readFile(resolveReceiptPath(storedPath));
}

export function isStoredReceiptPath(storedPath: string): boolean {
  return storedPath.replace(/\\/g, '/').startsWith(STORED_PREFIX);
}

export async function removeReceiptFile(storedPath: string): Promise<void> {
  try {
    await unlink(resolveReceiptPath(storedPath));
  } catch {
    // Cleanup is best-effort; the database operation remains authoritative.
  }
}

export function safeDownloadFileName(fileName: string | null | undefined, fallback: string): string {
  const baseName = path.basename(fileName || fallback).replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').trim();
  return baseName || fallback;
}
