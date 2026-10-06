import type { StructuredResult } from '@/lib/ai/llm';

export type ReceiptItemStatus = 'PENDING' | 'CONFIRMED' | 'SKIPPED';

export interface ReceiptRecognitionItem extends StructuredResult {
  confirmationStatus: ReceiptItemStatus;
  reagentId?: string;
  confirmedAt?: string;
  skippedAt?: string;
}

export interface ReceiptRecognitionResult {
  version: 2;
  ocrText: string;
  /** 最终进入核对列表的条目数（含 CAS 兜底补回条目）。 */
  compoundCount: number;
  /** LLM 在结构化 JSON 中声明的数量，用于发现模型计数与 items 不一致。 */
  llmDeclaredCompoundCount?: number;
  items: ReceiptRecognitionItem[];
  processing: {
    status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    queuedAt: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
  };
}

/** PaddleOCR 的 Markdown 偶尔包含不可访问的临时图片；核对区只保留可读原文。 */
export function stripOcrImages(markdown: string): string {
  return markdown
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/!\[[^\]]*\]\((?:[^()\s]+|\([^)]*\))*\)/g, '')
    .replace(/<div\b[^>]*>\s*<\/div>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isReceiptRecognitionResult(value: unknown): value is ReceiptRecognitionResult {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.version === 2 && Array.isArray(record.items) && typeof record.processing === 'object';
}

export function pendingReceiptItemCount(value: unknown): number {
  if (!isReceiptRecognitionResult(value)) return 0;
  return value.items.filter((item) => item.confirmationStatus === 'PENDING').length;
}

/** 从 OCR 原文中提取所有不重复的 CAS 号，避免模型遗漏票据后续行。 */
export function extractCasNumbers(text: string): string[] {
  return [...new Set(text.match(/\b\d{2,7}-\d{2}-\d\b/g) ?? [])];
}

/**
 * LLM 少返回某个 CAS 行时补一个可核对条目；用户确认入库时再按最终 CAS 调用 PubChem。
 * 这不是静默猜测：兜底条目仍保留在确认页，由实验员核对或选择不入库。
 */
export function ensureItemsForOcrCas(
  items: StructuredResult[],
  ocrText: string,
  source: 'OCR' | 'VLM' = 'OCR'
): StructuredResult[] {
  const known = new Set(items.map((item) => item.casNumber.trim()).filter(Boolean));
  const missing = extractCasNumbers(ocrText).filter((casNumber) => !known.has(casNumber));
  return [
    ...items,
    ...missing.map((casNumber): StructuredResult => ({
      reagentName: '',
      casNumber,
      specification: '',
      remarks: '',
      brand: '',
      dangerCategory: '',
      riskLevel: 'LOW',
      isHazardous: false,
      isControlled: false,
      storageLocation: '',
      quantity: 1,
      batchNumber: '',
      confidence: 0.5,
      source,
      llmStatus: 'fallback',
      llmError: 'LLM 未返回该 CAS 所在行，系统已从 OCR 原文补回，请人工核对字段',
    })),
  ];
}
