const FULL_DOCUMENT_FENCE = /^```(?:html?|markdown|md)\s*\r?\n([\s\S]*?)\r?\n```\s*$/i;

/**
 * 模型有时会把整段回答误包在 html / markdown 代码围栏中。
 * 仅解开“整条消息只有一个围栏”的情况，避免影响回答中真正的代码示例。
 */
export function normalizeAssistantMarkup(content: string): string {
  const match = content.trim().match(FULL_DOCUMENT_FENCE);
  return match ? match[1].trim() : content;
}

export function isSafeAssistantImageSource(source: string | undefined): source is string {
  if (!source) return false;
  if (source.startsWith('/') && !source.startsWith('//')) return true;

  try {
    return new URL(source).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Read old structure links without treating an unescaped charge '+' as a space. */
export function structureSmiles(source: string): string | null {
  if (!source.startsWith('/api/assistant/structure?')) return null;
  const raw = source.slice(source.indexOf('?') + 1).split('&').find(part => part.startsWith('smiles='));
  if (!raw) return null;
  try { return decodeURIComponent(raw.slice(7)).trim(); } catch { return null; }
}
export function structureImageUrl(smiles: string): string {
  // encodeURIComponent leaves parentheses intact, which can break Markdown destinations.
  return '/api/assistant/structure?smiles=' + encodeURIComponent(smiles.trim()).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
