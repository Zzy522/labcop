import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { durableWriteFile } from '@/lib/durable-file';
import { Errors } from '@/lib/errors';

const run = promisify(execFile);
const root = path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'assistant-attachments');
export const ATTACHMENT_EXTENSIONS = new Set(['.docx', '.pptx', '.pdf', '.txt', '.md', '.csv']);
let extracting = false;
function directory(userId: string, labId: string) {
  // Scope is derived exclusively from the authenticated identity, never client paths.
  const scope = createHash('sha256').update(JSON.stringify([labId, userId])).digest('hex');
  return path.join(root, scope);
}
export type AssistantAttachment = { id: string; name: string; text: string; warning: string; sha256: string; size: number };
export async function saveAssistantAttachment(file: File, userId: string, labId: string): Promise<AssistantAttachment> {
  const extension = path.extname(file.name).toLowerCase();
  if (!ATTACHMENT_EXTENSIONS.has(extension)) throw Errors.validationError('请上传 DOCX、PPTX、PDF、TXT、MD 或 CSV；旧版 DOC/PPT 请另存为新版格式');
  if (!file.size || file.size > 10 * 1024 * 1024) throw Errors.validationError('文件大小须为 1 字节至 10MB');
  if (extracting) throw Errors.validationError('当前有文档正在解析，请稍后重试');
  extracting = true;
  try {
    const folder = directory(userId, labId);
    await mkdir(folder, { recursive: true });
    const id = randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(folder, id + extension);
    await durableWriteFile(filePath, buffer);
    let result: { text: string; warning: string };
    try {
      const { stdout } = await run(process.execPath, ['--max-old-space-size=256', path.join(/* turbopackIgnore: true */ process.cwd(), 'scripts', 'document-reader.mjs'), filePath, extension], { timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
      result = JSON.parse(stdout);
    } catch {
      throw Errors.validationError('解析失败：可能为扫描件、加密/损坏文件、非 UTF-8 文本或超过解析限制。请转换格式、拆分文件或上传截图。原文件已保留。');
    }
    const attachment = { id, name: file.name.slice(0, 200), text: result.text, warning: result.warning, sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length };
    await durableWriteFile(path.join(folder, id + '.json'), Buffer.from(JSON.stringify({ ...attachment, extension, createdAt: new Date().toISOString() })));
    return attachment;
  } finally { extracting = false; }
}

export async function readAssistantAttachments(ids: unknown, userId: string, labId: string): Promise<AssistantAttachment[]> {
  if (ids === undefined) return [];
  if (!Array.isArray(ids) || ids.length > 3 || ids.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) throw Errors.validationError('附件编号无效，每次最多 3 个文档');
  return Promise.all([...new Set(ids as string[])].map(async id => {
    try { return JSON.parse(await readFile(path.join(directory(userId, labId), id + '.json'), 'utf8')) as AssistantAttachment; }
    catch { throw Errors.notFound('附件或访问权限'); }
  }));
}
