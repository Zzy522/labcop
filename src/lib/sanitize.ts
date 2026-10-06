/**
 * HTML 净化包装 — 基于 DOMPurify，用于安全渲染 OCR/LLM 返回的富文本
 *
 * 仅在浏览器端执行（DOMPurify 依赖 DOM）；SSR 阶段返回空串避免注入。
 * 用法：dangerouslySetInnerHTML={{ __html: sanitizeHtml(dirty) }}
 */
import DOMPurify from 'dompurify';

export function sanitizeHtml(dirty: string): string {
  if (typeof window === 'undefined') return '';
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    // 禁止所有脚本与事件，保留表格/图片/列表等结构
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  });
}
