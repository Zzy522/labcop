import { prisma } from '@/lib/prisma';
import { runPaddleOCR } from '@/lib/ai/paddleocr-server';
import { structureBatchWithLLM } from '@/lib/ai/llm';
import { readReceiptFile } from '@/lib/receipt-storage';
import {
  ensureItemsForOcrCas,
  stripOcrImages,
  type ReceiptRecognitionResult,
} from '@/lib/receipt-ocr';

const activeDocuments = new Set<string>();

function serializable(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export async function processReceiptDocument(documentId: string): Promise<void> {
  if (activeDocuments.has(documentId)) return;
  activeDocuments.add(documentId);
  const processingToken = crypto.randomUUID();
  try {
    const claimed = await prisma.document.updateMany({
      where: { id: documentId, status: 'QUEUED', processingMode: 'OCR' },
      data: { status: 'PROCESSING', processingToken, processingLeaseAt: new Date(Date.now() + 15 * 60 * 1000) },
    });
    if (claimed.count === 0) return;

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true, fileUrl: true, fileName: true, mimeType: true,
        labId: true, uploadedById: true, createdAt: true,
      },
    });
    if (!document?.labId) throw new Error('票据没有关联实验室');

    const queuedAt = document.createdAt.toISOString();
    const startedAt = new Date().toISOString();
    const processingResult: ReceiptRecognitionResult = {
      version: 2,
      ocrText: '',
      compoundCount: 0,
      items: [],
      processing: { status: 'PROCESSING', queuedAt, startedAt },
    };
    await prisma.document.updateMany({
      where: { id: documentId, status: 'PROCESSING', processingToken },
      data: { recognitionResult: serializable(processingResult) },
    });

    const buffer = await readReceiptFile(document.fileUrl);
    const file = new File([new Uint8Array(buffer)], document.fileName || 'receipt.jpg', {
      type: document.mimeType || 'image/jpeg',
    });
    const ocrResult = await runPaddleOCR(file, {
      labId: document.labId,
      userId: document.uploadedById,
    });
    const ocrText = stripOcrImages(ocrResult.text);
    const llmBatch = await structureBatchWithLLM({}, 'OCR', {
      ocrText,
      labId: document.labId,
      userId: document.uploadedById,
    });
    const extracted = ensureItemsForOcrCas(llmBatch.items, ocrText);
    if (extracted.every((item) => !item.reagentName.trim() && !item.casNumber.trim())) {
      throw new Error(extracted[0]?.llmError || '未从票据中识别到试剂或 CAS 号');
    }
    const enriched = await Promise.all(extracted.map(async (item) => {
      if (item.storageLocation.trim()) return item;
      if (!item.casNumber.trim() && !item.reagentName.trim()) return item;
      const existing = await prisma.reagent.findFirst({
        where: {
          labId: document.labId!,
          OR: [
            ...(item.casNumber.trim() ? [{ casNumber: item.casNumber.trim() }] : []),
            ...(item.reagentName.trim() ? [{ name: item.reagentName.trim() }] : []),
          ],
        },
        select: { storageLocation: true },
        orderBy: { createdAt: 'desc' },
      });
      return existing?.storageLocation ? { ...item, storageLocation: existing.storageLocation } : item;
    }));
    const completedAt = new Date().toISOString();
    const result: ReceiptRecognitionResult = {
      version: 2,
      ocrText,
      compoundCount: enriched.length,
      llmDeclaredCompoundCount: llmBatch.declaredCompoundCount,
      items: enriched.map((item) => ({ ...item, confirmationStatus: 'PENDING' })),
      processing: { status: 'COMPLETED', queuedAt, startedAt, completedAt },
    };
    const first = result.items[0];
    await prisma.document.updateMany({
      where: { id: documentId, status: 'PROCESSING', processingToken },
      data: {
        recognitionResult: serializable(result),
        status: 'PENDING',
        processingToken: null, processingLeaseAt: null,
        reagentName: first?.reagentName || null,
        casNumber: first?.casNumber || null,
        brand: first?.brand || null,
        riskLevel: first?.riskLevel || null,
        isHazardous: first?.isHazardous ?? null,
        isControlled: first?.isControlled ?? null,
      },
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : 'OCR 处理失败';
    console.error(`[receipt-ocr] ${documentId} 处理失败:`, error);
    await prisma.document.updateMany({
      where: { id: documentId, status: 'PROCESSING', processingToken },
      data: {
        status: 'REJECTED',
        processingToken: null, processingLeaseAt: null,
        recognitionResult: serializable({
          version: 2,
          ocrText: '',
          compoundCount: 0,
          items: [],
          processing: { status: 'FAILED', queuedAt: failedAt, completedAt: failedAt, error: message },
        } satisfies ReceiptRecognitionResult),
      },
    }).catch(() => undefined);
  } finally {
    activeDocuments.delete(documentId);
  }
}

export async function processReceiptDocuments(documentIds: string[]): Promise<void> {
  // 最多 3 张并发：缩短多图等待时间，同时避免连续拍照压垮 OCR/LLM 上游。
  for (let index = 0; index < documentIds.length; index += 3) {
    await Promise.all(documentIds.slice(index, index + 3).map(processReceiptDocument));
  }
}

export async function processQueuedReceiptDocuments(limit = 3): Promise<void> {
  await prisma.document.updateMany({
    where: { processingMode: 'OCR', status: 'PROCESSING', OR: [{ processingLeaseAt: { lt: new Date() } }, { processingLeaseAt: null }] },
    data: { status: 'QUEUED', processingToken: null, processingLeaseAt: null },
  });
  const queued = await prisma.document.findMany({
    where: { processingMode: 'OCR', status: 'QUEUED' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  await processReceiptDocuments(queued.map((document) => document.id));
}
