import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { validateWeeklyReportAttachments } from '@/lib/validations/project';

const mocks = vi.hoisted(() => ({ save: vi.fn(), snapshot: vi.fn(), create: vi.fn(), backup: vi.fn(), log: vi.fn(), access: vi.fn() }));
vi.mock('@/lib/auth-middleware', () => ({
  requireAuth: vi.fn(async () => ({ userId: 'u1', labId: 'lab1' })),
  isUserContext: () => true,
}));
vi.mock('@/lib/research/projects', () => ({ getProjectAccess: mocks.access }));
vi.mock('@/lib/project-storage', () => ({ saveWeeklyReportAttachment: mocks.save, writeProjectBackupSnapshot: mocks.snapshot }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
    projectWeeklyReport: { create: mocks.create }, projectBackupSnapshot: { create: mocks.backup }, projectChangeLog: { create: mocks.log },
  }),
} }));
import { POST } from '@/app/api/projects/[id]/weekly-reports/route';

function request(content: string, filename = '进展.pptx') {
  const form = new FormData();
  form.set('weekStart', '2026-09-21T04:00:00.000Z');
  form.set('title', '课题周报');
  form.set('content', content);
  form.append('attachments', new File(['presentation fixture'], filename, { type: 'application/octet-stream' }));
  return new NextRequest('http://localhost/api/projects/p1/weekly-reports', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ fileName: '进展.pptx', sha256: 'checksum', fileUrl: 'primary', backupUrl: 'backup' });
  mocks.snapshot.mockResolvedValue({ fileUrl: 'snapshot', checksum: 'checksum' });
  mocks.create.mockImplementation(async ({ data }) => ({ ...data, createdAt: new Date(), attachments: [] }));
});

describe('weekly report multipart upload', () => {
  it.each(['进展.ppt', '进展.pptx'])('accepts %s with valid text and saves snapshot metadata', async (filename) => {
    const response = await POST(request('本周已经完成样品制备以及实验结果分析。', filename), { params: Promise.resolve({ id: 'p1' }) });
    expect(response.status).toBe(201);
    expect(mocks.access).toHaveBeenCalledWith('p1', expect.objectContaining({ userId: 'u1' }));
    expect(mocks.save).toHaveBeenCalledWith('p1', expect.any(String), expect.objectContaining({ name: filename }));
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.backup).toHaveBeenCalledTimes(1);
  });
  it('explains short trimmed progress without writing any files or reports', async () => {
    const response = await POST(request('  详见附件         '), { params: Promise.resolve({ id: 'p1' }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('本周进展至少 10 个字符');
    expect(body.details.content).toHaveLength(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects excessive count, empty files, per-file and total size without silently dropping attachments', () => {
    const file = { name: '周报.pptx', size: 15 * 1024 * 1024 };
    expect(validateWeeklyReportAttachments([file])).toBeNull();
    expect(validateWeeklyReportAttachments(Array(9).fill(file))).toContain('最多 8 个');
    expect(validateWeeklyReportAttachments([{ ...file, size: 0 }])).toContain('为空文件');
    expect(validateWeeklyReportAttachments([{ ...file, size: file.size + 1 }])).toContain('15MB');
    expect(validateWeeklyReportAttachments(Array(4).fill(file))).toContain('50MB');
    expect(validateWeeklyReportAttachments([{ name: 'run.exe', size: 1 }])).toContain('可执行');
  });
});
