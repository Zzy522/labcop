import { after, type NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { classifyDocument } from '@/lib/ai/routing';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { AppError, Errors, toAppError } from '@/lib/errors';
import { saveReceiptFile } from '@/lib/receipt-storage';
import { processReceiptDocuments } from '@/lib/services/receipt-ocr.service';
import type { ReceiptRecognitionResult } from '@/lib/receipt-ocr';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_FILE_COUNT = 10;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 只负责校验、持久化原图并创建队列记录，OCR/LLM/PubChem 在响应后执行。
 * 任务状态存放在 Document 中，进程重启后由 scheduler 补偿，不依赖浏览器保持页面。
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室，无法上传文件' }, { status: 403 });

  const formData = await request.formData();
  const files = formData.getAll('files') as File[];
  const docType = (formData.get('type') as string) || 'STOCK_IN';
  if (!files.length) return NextResponse.json({ error: '请至少上传一个文件' }, { status: 400 });
  if (files.length > MAX_FILE_COUNT) {
    return NextResponse.json({ error: `最多同时上传 ${MAX_FILE_COUNT} 个文件` }, { status: 400 });
  }

  const jobs: Array<{ documentId: string; fileName: string; category: string; status: 'QUEUED' }> = [];
  const failures: Array<{ fileName: string; error: string; appError: AppError }> = [];

  for (const file of files) {
    let storedPath: string | null = null;
    try {
      if (!ALLOWED_MIME.has(file.type)) {
        throw Errors.validationError(`不支持的文件类型：${file.type || '未知'}（智能识别仅支持 JPG、PNG、WebP）`);
      }
      if (!file.size || file.size > MAX_FILE_SIZE) {
        throw Errors.validationError(`文件不能为空且不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB`);
      }

      const category = classifyDocument(file.name, file.type);
      storedPath = await saveReceiptFile(file);
      const queuedAt = new Date().toISOString();
      const initialResult: ReceiptRecognitionResult = {
        version: 2,
        ocrText: '',
        compoundCount: 0,
        items: [],
        processing: { status: 'QUEUED', queuedAt },
      };
      try {
        const document = await prisma.document.create({
          data: {
            type: docType,
            fileUrl: storedPath,
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size,
            recognitionResult: JSON.parse(JSON.stringify(initialResult)),
            status: 'QUEUED',
            processingMode: 'OCR',
            uploadedById: authResult.userId,
            labId: authResult.labId,
          },
        });
        jobs.push({ documentId: document.id, fileName: file.name, category, status: 'QUEUED' });
      } catch (error) {
        // Preserve the original: a failed response does not prove the database commit failed.
        throw error;
      }
    } catch (error) {
      const appError = toAppError(error);
      failures.push({ fileName: file.name, error: appError.message, appError });
    }
  }

  if (!jobs.length) {
    const first = failures[0];
    const error = first?.appError ?? Errors.internal('上传失败');
    return NextResponse.json({ error: error.message, category: error.category }, { status: error.httpStatus });
  }

  const jobIds = jobs.map((job) => job.documentId);
  after(() => processReceiptDocuments(jobIds));
  return NextResponse.json({
    jobs,
    failures: failures.map((failure) => ({ fileName: failure.fileName, error: failure.error })),
    message: `已加入识别队列，共 ${jobs.length} 张票据`,
  }, { status: 202 });
});
