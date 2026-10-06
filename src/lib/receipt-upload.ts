export const MAX_RECEIPT_FILE_SIZE = 10 * 1024 * 1024;

export const ALLOWED_RECEIPT_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export function validateReceiptFile(file: File): string | null {
  if (!file.name || file.size === 0) return '票据文件不能为空';
  if (!ALLOWED_RECEIPT_MIME.has(file.type)) {
    return '仅支持 JPG、PNG、WebP 或 PDF 票据';
  }
  if (file.size > MAX_RECEIPT_FILE_SIZE) {
    return `票据文件不能超过 ${MAX_RECEIPT_FILE_SIZE / 1024 / 1024}MB`;
  }
  return null;
}
