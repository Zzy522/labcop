import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { readReceiptFile, safeDownloadFileName } from '@/lib/receipt-storage';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });

  const { id } = await params;
  const document = await prisma.document.findFirst({
    where: {
      id,
      labId: authResult.labId,
      type: 'STOCK_IN',
      ...(authResult.isAdmin ? {} : { uploadedById: authResult.userId }),
    },
    select: { fileUrl: true, fileName: true, mimeType: true },
  });
  if (!document) return NextResponse.json({ error: '票据不存在或无权访问' }, { status: 404 });

  let data: Buffer;
  try {
    data = await readReceiptFile(document.fileUrl);
  } catch {
    return NextResponse.json({ error: '原始票据文件不存在，可能是历史识别记录' }, { status: 404 });
  }

  const fileName = safeDownloadFileName(document.fileName, `receipt-${id}`);
  const download = new URL(request.url).searchParams.get('download') === '1';
  const canPreview = document.mimeType?.startsWith('image/') || document.mimeType === 'application/pdf';
  const disposition = download || !canPreview ? 'attachment' : 'inline';
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': document.mimeType || 'application/octet-stream',
      'Content-Length': String(data.length),
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
