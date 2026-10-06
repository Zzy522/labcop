import { durableWriteFile } from '@/lib/durable-file';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const PROJECT_STORAGE_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'projects');
const PROJECT_BACKUP_ROOT = path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'backups', 'projects');

function safeSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('无效的课题存储标识');
  return safe;
}

function safeExtension(name: string): string {
  const ext = path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return ext.length <= 10 ? ext : '';
}

export async function saveProjectDocumentFile(projectId: string, file: File): Promise<string> {
  const projectFolder = safeSegment(projectId);
  const directory = path.join(PROJECT_STORAGE_ROOT, projectFolder);
  await mkdir(directory, { recursive: true });
  const name = `${crypto.randomUUID()}${safeExtension(file.name)}`;
  await durableWriteFile(path.join(directory, name), Buffer.from(await file.arrayBuffer()));
  return `data/projects/${projectFolder}/${name}`;
}

export interface StoredWeeklyReportAttachment {
  fileUrl: string;
  backupUrl: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number;
  sha256: string;
}

export async function saveWeeklyReportAttachment(projectId: string, reportId: string, file: File): Promise<StoredWeeklyReportAttachment> {
  const projectFolder = safeSegment(projectId);
  const reportFolder = safeSegment(reportId);
  const fileName = `${crypto.randomUUID()}${safeExtension(file.name)}`;
  const relativePrimary = `data/projects/${projectFolder}/weekly-reports/${reportFolder}/${fileName}`;
  const relativeBackup = `data/backups/projects/${projectFolder}/weekly-reports/${reportFolder}/${fileName}`;
  const primaryDirectory = path.join(PROJECT_STORAGE_ROOT, projectFolder, 'weekly-reports', reportFolder);
  const backupDirectory = path.join(PROJECT_BACKUP_ROOT, projectFolder, 'weekly-reports', reportFolder);
  const buffer = Buffer.from(await file.arrayBuffer());
  await Promise.all([
    mkdir(primaryDirectory, { recursive: true }),
    mkdir(backupDirectory, { recursive: true }),
  ]);
  await Promise.all([
    durableWriteFile(path.join(primaryDirectory, fileName), buffer),
    durableWriteFile(path.join(backupDirectory, fileName), buffer),
  ]);
  return {
    fileUrl: relativePrimary,
    backupUrl: relativeBackup,
    fileName: file.name,
    mimeType: file.type || null,
    fileSize: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function writeProjectBackupSnapshot(projectId: string, entityType: string, entityId: string, value: unknown): Promise<{ fileUrl: string; checksum: string }> {
  const projectFolder = safeSegment(projectId);
  const entityFolder = safeSegment(entityType.toLowerCase());
  const safeEntityId = safeSegment(entityId);
  const directory = path.join(PROJECT_BACKUP_ROOT, projectFolder, 'snapshots', entityFolder);
  const fileName = `${safeEntityId}-${Date.now()}-${crypto.randomUUID()}.json`;
  const content = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  await mkdir(directory, { recursive: true });
  await durableWriteFile(path.join(directory, fileName), content);
  return {
    fileUrl: `data/backups/projects/${projectFolder}/snapshots/${entityFolder}/${fileName}`,
    checksum: createHash('sha256').update(content).digest('hex'),
  };
}

export async function readProjectDocumentFile(storedPath: string): Promise<Buffer> {
  const normalizedRelative = storedPath.replace(/\\/g, '/');
  if (!normalizedRelative.startsWith('data/projects/')) throw new Error('无效的课题文件路径');
  const absolutePath = path.resolve(/* turbopackIgnore: true */ process.cwd(), normalizedRelative);
  const storageRoot = `${PROJECT_STORAGE_ROOT}${path.sep}`;
  if (!absolutePath.startsWith(storageRoot)) throw new Error('无效的课题文件路径');
  return readFile(absolutePath);
}

export async function removeProjectStorage(projectId: string): Promise<void> {
  const projectFolder = safeSegment(projectId);
  const targets = [
    path.join(PROJECT_STORAGE_ROOT, projectFolder),
    path.join(PROJECT_BACKUP_ROOT, projectFolder),
  ];
  await Promise.all(targets.map(async (target) => {
    try {
      await rm(target, { recursive: true, force: true });
    } catch {
      // 文件清理由数据库删除触发；失败时保留孤立文件并交由运维扫描处理。
    }
  }));
}
