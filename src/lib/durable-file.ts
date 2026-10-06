import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/** Publish only a completely written, synced file. Caller creates the parent directory. */
export async function durableWriteFile(target: string, content: Uint8Array) {
  const temporary = `${target}.${crypto.randomUUID()}.pending`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } catch (error) {
    await file.close();
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  await file.close();
  await rename(temporary, target);
  if (process.platform !== 'win32') {
    const directory = await open(path.dirname(target), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
