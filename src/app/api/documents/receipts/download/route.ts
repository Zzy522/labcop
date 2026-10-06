import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { readReceiptFile, safeDownloadFileName } from '@/lib/receipt-storage';
import { createStoredZip } from '@/lib/zip';

const requestSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });
const MAX_ARCHIVE_SIZE = 200 * 1024 * 1024;

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });

  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '请选择 1 至 100 张票据' }, { status: 400 });

  const documents = await prisma.document.findMany({
    where: { id: { in: parsed.data.ids }, labId: authResult.labId, type: 'STOCK_IN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, fileUrl: true, fileName: true, createdAt: true },
  });
  if (documents.length === 0) return NextResponse.json({ error: '所选票据没有可下载文件' }, { status: 404 });

  let totalSize = 0;
  const entries: Array<{ name: string; data: Buffer; modifiedAt: Date }> = [];
  for (const [index, document] of documents.entries()) {
    try {
      const data = await readReceiptFile(document.fileUrl);
      totalSize += data.length;
      if (totalSize > MAX_ARCHIVE_SIZE) {
        return NextResponse.json({ error: '所选票据总大小超过 200MB，请分批下载' }, { status: 413 });
      }
      const originalName = safeDownloadFileName(document.fileName, `receipt-${document.id}`);
      entries.push({ name: `${String(index + 1).padStart(3, '0')}_${originalName}`, data, modifiedAt: document.createdAt });
    } catch {
      // Skip legacy records that have no physical original file.
    }
  }
  if (entries.length === 0) return NextResponse.json({ error: '所选票据原始文件均不存在' }, { status: 404 });

  const archive = createStoredZip(entries);
  const fileName = `reagent-receipts-${new Date().toISOString().slice(0, 10)}.zip`;
  return new NextResponse(new Uint8Array(archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(archive.length),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
});
