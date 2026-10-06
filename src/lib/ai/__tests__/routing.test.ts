import { describe, it, expect } from 'vitest';
import { classifyDocument } from '../routing';

describe('classifyDocument 文档分类路由', () => {
  it('PDF 应归类为 DOCUMENT', () => {
    expect(classifyDocument('验收单.pdf', 'application/pdf')).toBe('DOCUMENT');
  });

  it('文件名含"入库"的图片应归类为 DOCUMENT', () => {
    expect(classifyDocument('入库单.jpg', 'image/jpeg')).toBe('DOCUMENT');
  });

  it('文件名含"采购"的图片应归类为 DOCUMENT', () => {
    expect(classifyDocument('采购单.png', 'image/png')).toBe('DOCUMENT');
  });

  it('文件名含"验收"的图片应归类为 DOCUMENT', () => {
    expect(classifyDocument('验收单.jpeg', 'image/jpeg')).toBe('DOCUMENT');
  });

  it('普通照片应归类为 PHOTO', () => {
    expect(classifyDocument('IMG_001.jpg', 'image/jpeg')).toBe('PHOTO');
  });

  it('试剂瓶照片应归类为 PHOTO', () => {
    expect(classifyDocument('试剂瓶.jpg', 'image/jpeg')).toBe('PHOTO');
  });

  it('receipt 关键词应归类为 DOCUMENT', () => {
    expect(classifyDocument('receipt_scan.png', 'image/png')).toBe('DOCUMENT');
  });

  it('非图片非PDF应归类为 DOCUMENT', () => {
    expect(classifyDocument('data.xlsx', 'application/vnd.ms-excel')).toBe('DOCUMENT');
  });
});
