export type DocumentCategory = 'DOCUMENT' | 'PHOTO';

/**
 * 判断文件类型走 OCR+LLM 还是 VLM
 * - DOCUMENT: PDF 和包含单据关键词的图片 → OCR 识别 + LLM 结构化
 * - PHOTO: 普通图片 → VLM 直接识别
 */
export function classifyDocument(fileName: string, mimeType: string): DocumentCategory {
  // PDF 和常见文档走 DOCUMENT (OCR+LLM)
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return 'DOCUMENT';
  // 图片根据文件名判断
  const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (imageTypes.includes(mimeType)) {
    // 如果文件名包含 单据/入库/采购/验收 等关键词，走 DOCUMENT
    const docKeywords = ['单据', '入库', '采购', '验收', 'receipt', 'order', 'invoice'];
    if (docKeywords.some(k => fileName.includes(k))) return 'DOCUMENT';
    return 'PHOTO'; // 否则走 VLM
  }
  return 'DOCUMENT';
}
