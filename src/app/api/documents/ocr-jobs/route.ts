import { type NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { isReceiptRecognitionResult } from '@/lib/receipt-ocr';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  if (!auth.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });

  const documents = await prisma.document.findMany({
    where: {
      labId: auth.labId,
      uploadedById: auth.userId,
      processingMode: 'OCR',
      status: { in: ['QUEUED', 'PROCESSING', 'PENDING', 'REJECTED'] },
    },
    select: {
      id: true, fileName: true, mimeType: true, fileSize: true,
      status: true, recognitionResult: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const jobs = documents.map((document) => {
    const result = isReceiptRecognitionResult(document.recognitionResult) ? document.recognitionResult : null;
    return {
      documentId: document.id,
      fileName: document.fileName || '未命名票据',
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      status: document.status,
      createdAt: document.createdAt.toISOString(),
      originalFileUrl: `/api/documents/receipts/${document.id}/file`,
      ocrText: result?.ocrText || '',
      processing: result?.processing || null,
      compoundCount: result?.compoundCount ?? result?.items.length ?? 0,
      llmDeclaredCompoundCount: result?.llmDeclaredCompoundCount ?? result?.items.length ?? 0,
      items: result?.items || [],
    };
  });

  return NextResponse.json({
    jobs,
    summary: {
      queued: jobs.filter((job) => job.status === 'QUEUED').length,
      processing: jobs.filter((job) => job.status === 'PROCESSING').length,
      failed: jobs.filter((job) => job.status === 'REJECTED').length,
      pendingItems: jobs.reduce((sum, job) => sum + job.items.filter((item) => item.confirmationStatus === 'PENDING').length, 0),
    },
  });
});
