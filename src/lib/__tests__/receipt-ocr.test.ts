import { describe, expect, it } from 'vitest';
import {
  ensureItemsForOcrCas,
  extractCasNumbers,
  isReceiptRecognitionResult,
  pendingReceiptItemCount,
  stripOcrImages,
} from '@/lib/receipt-ocr';
import type { StructuredResult } from '@/lib/ai/llm';
import { normalizeStructuredBatchExtraction, separateSpecificationRemarks } from '@/lib/ai/llm';

function item(overrides: Partial<StructuredResult> = {}): StructuredResult {
  return {
    reagentName: '盐酸',
    casNumber: '7647-01-0',
    specification: 'AR, 500mL',
    remarks: '',
    brand: '',
    dangerCategory: '腐蚀性',
    riskLevel: 'HIGH',
    isHazardous: true,
    isControlled: false,
    storageLocation: '',
    quantity: 1,
    batchNumber: '',
    confidence: 0.9,
    source: 'OCR',
    llmStatus: 'ok',
    ...overrides,
  };
}

describe('receipt OCR result helpers', () => {
  it('keeps the LLM-declared compound count and structures every returned item', () => {
    const batch = normalizeStructuredBatchExtraction({
      compoundCount: 2,
      items: [
        { reagentName: '盐酸', casNumber: '7647-01-0', quantity: 1, riskLevel: 'HIGH' },
        { reagentName: '乙醇', casNumber: '64-17-5', quantity: 2, riskLevel: 'HIGH' },
      ],
    }, 'OCR');
    expect(batch.declaredCompoundCount).toBe(2);
    expect(batch.items.map((entry) => entry.casNumber)).toEqual(['7647-01-0', '64-17-5']);
  });

  it('separates concentration and purity from the package specification', () => {
    expect(separateSpecificationRemarks('98.75%, 10mg', '')).toEqual({
      specification: '10mg',
      remarks: '98.75%',
    });
    expect(separateSpecificationRemarks('10mg/mL, 5mL', '')).toEqual({
      specification: '5mL',
      remarks: '10mg/mL',
    });
    expect(separateSpecificationRemarks('AR 500mL', '进口试剂')).toEqual({
      specification: '500mL',
      remarks: '进口试剂；AR',
    });
  });

  it('removes broken HTML and Markdown images but preserves extracted text', () => {
    const source = '# 票据\n<img src="https://temporary.invalid/a.png">\n盐酸 7647-01-0\n![crop](broken.png)';
    expect(stripOcrImages(source)).toBe('# 票据\n\n盐酸 7647-01-0');
  });

  it('extracts each unique CAS number in source order', () => {
    expect(extractCasNumbers('盐酸 7647-01-0\n乙醇 64-17-5\n重复 7647-01-0')).toEqual([
      '7647-01-0',
      '64-17-5',
    ]);
  });

  it('adds a review item when LLM misses a later CAS row', () => {
    const result = ensureItemsForOcrCas([item()], '盐酸 7647-01-0\n乙醇 64-17-5');
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ casNumber: '64-17-5', llmStatus: 'fallback', quantity: 1 });
  });

  it('counts only unconfirmed items in version 2 data', () => {
    const result = {
      version: 2 as const,
      ocrText: 'text',
      compoundCount: 3,
      items: [
        { ...item(), confirmationStatus: 'PENDING' as const },
        { ...item({ casNumber: '64-17-5' }), confirmationStatus: 'CONFIRMED' as const, reagentId: 'r1' },
        { ...item({ casNumber: '67-56-1' }), confirmationStatus: 'SKIPPED' as const },
      ],
      processing: { status: 'COMPLETED' as const, queuedAt: new Date(0).toISOString() },
    };
    expect(isReceiptRecognitionResult(result)).toBe(true);
    expect(pendingReceiptItemCount(result)).toBe(1);
    expect(pendingReceiptItemCount({ reagentName: 'legacy' })).toBe(0);
  });
});
