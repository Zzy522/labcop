import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';

const files = vi.hoisted(() => new Map<string, string>());
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  readFile: vi.fn(async (file: string) => {
    if (!files.has(file)) throw new Error('ENOENT');
    return files.get(file);
  }),
}));
import { readAssistantAttachments } from '@/lib/assistant-attachments';
const id = '12345678-1234-4234-8234-123456789abc';
beforeEach(() => {
  files.clear();
  const scope = createHash('sha256').update(JSON.stringify(['lab-a', 'user-a'])).digest('hex');
  files.set(path.join(process.cwd(), 'data', 'assistant-attachments', scope, id + '.json'), JSON.stringify({ id, text: 'private research', name: 'private.txt' }));
});
describe('附件身份与租户边界', () => {
  it('只有原用户在原实验室可读取，重新注册的新 ID 不继承附件', async () => {
    expect((await readAssistantAttachments([id], 'user-a', 'lab-a'))[0].text).toBe('private research');
    await expect(readAssistantAttachments([id], 'user-b', 'lab-a')).rejects.toThrow('访问权限');
    await expect(readAssistantAttachments([id], 'user-a', 'lab-b')).rejects.toThrow('访问权限');
  });
  it('拒绝路径穿越和超量附件，重复编号只读取一次', async () => {
    await expect(readAssistantAttachments(['../../secret'], 'user-a', 'lab-a')).rejects.toThrow('编号无效');
    await expect(readAssistantAttachments([id, id, id, id], 'user-a', 'lab-a')).rejects.toThrow('最多');
    expect(await readAssistantAttachments([id, id], 'user-a', 'lab-a')).toHaveLength(1);
  });
});
