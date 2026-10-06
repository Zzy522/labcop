import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isStoredReceiptPath, resolveReceiptPath, safeDownloadFileName } from '@/lib/receipt-storage';
import { createStoredZip } from '@/lib/zip';

describe('receipt storage', () => {
  it('only resolves paths inside the private receipt directory', () => {
    const resolved = resolveReceiptPath('data/receipts/test.png');
    expect(resolved).toBe(path.resolve(process.cwd(), 'data', 'receipts', 'test.png'));
    expect(isStoredReceiptPath('data/receipts/test.png')).toBe(true);
    expect(isStoredReceiptPath('public/uploads/test.png')).toBe(false);
    expect(() => resolveReceiptPath('public/uploads/test.png')).toThrow('没有可用');
    expect(() => resolveReceiptPath('data/receipts/../secret.txt')).toThrow('路径无效');
  });

  it('removes path separators and reserved file-name characters', () => {
    expect(safeDownloadFileName('../票据<1>.png', 'receipt.png')).toBe('票据_1_.png');
  });
});

describe('receipt ZIP archive', () => {
  it('creates a UTF-8 ZIP with local, central and end records', () => {
    const archive = createStoredZip([
      { name: '001_乙醇票据.txt', data: Buffer.from('receipt-one'), modifiedAt: new Date('2026-08-04T12:00:00') },
      { name: '002_test.txt', data: Buffer.from('receipt-two'), modifiedAt: new Date('2026-08-04T12:00:00') },
    ]);

    expect(archive.readUInt32LE(0)).toBe(0x04034b50);
    expect(archive.includes(Buffer.from('001_乙醇票据.txt', 'utf8'))).toBe(true);
    expect(archive.includes(Buffer.from('receipt-one'))).toBe(true);
    expect(archive.includes(Buffer.from('receipt-two'))).toBe(true);
    expect(archive.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02]))).toBe(true);
    expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
    expect(archive.readUInt16LE(archive.length - 12)).toBe(2);
  });
});
