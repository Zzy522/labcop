import { describe, expect, it } from 'vitest';
import { MAX_RECEIPT_FILE_SIZE, validateReceiptFile } from '../receipt-upload';

describe('receipt upload validation', () => {
  it('accepts supported non-empty receipt files', () => {
    expect(validateReceiptFile(new File(['receipt'], 'receipt.jpg', { type: 'image/jpeg' }))).toBeNull();
    expect(validateReceiptFile(new File(['pdf'], 'receipt.pdf', { type: 'application/pdf' }))).toBeNull();
  });

  it('rejects unsupported, empty and oversized files', () => {
    expect(validateReceiptFile(new File(['x'], 'receipt.exe', { type: 'application/octet-stream' }))).toContain('仅支持');
    expect(validateReceiptFile(new File([], 'empty.png', { type: 'image/png' }))).toContain('不能为空');
    expect(validateReceiptFile(new File([new Uint8Array(MAX_RECEIPT_FILE_SIZE + 1)], 'large.png', { type: 'image/png' }))).toContain('不能超过');
  });
});
