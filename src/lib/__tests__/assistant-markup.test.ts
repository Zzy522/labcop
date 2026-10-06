import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AssistantMessageContent } from '@/components/assistant/assistant-message-content';
import { isSafeAssistantImageSource, normalizeAssistantMarkup, structureImageUrl, structureSmiles } from '@/lib/assistant-markup';

describe('assistant message markup', () => {
  it('unwraps a full HTML fence but preserves an embedded code sample', () => {
    expect(normalizeAssistantMarkup('```html\n<table><tr><td>结果</td></tr></table>\n```'))
      .toBe('<table><tr><td>结果</td></tr></table>');
    expect(normalizeAssistantMarkup('示例：\n```html\n<div>代码</div>\n```'))
      .toContain('```html');
  });

  it('renders GFM tables and sanitized basic HTML instead of source text', () => {
    const html = renderToStaticMarkup(createElement(AssistantMessageContent, {
      content: '| 化合物 | CAS |\n|---|---|\n| 示例 | 123-45-6 |\n\n<table><tbody><tr><td>HTML表格</td></tr></tbody></table>',
    }));

    expect(html.match(/<table/g)).toHaveLength(2);
    expect(html).toContain('<td');
    expect(html).not.toContain('&lt;table&gt;');
  });

  it('removes executable HTML and rejects unsafe image sources', () => {
    const html = renderToStaticMarkup(createElement(AssistantMessageContent, {
      content: '<script>alert(1)</script><img src="javascript:alert(2)" onerror="alert(3)">',
    }));

    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onerror');
    expect(isSafeAssistantImageSource('/api/files/demo.png')).toBe(true);
    expect(isSafeAssistantImageSource('https://example.com/demo.png')).toBe(true);
    expect(isSafeAssistantImageSource('http://example.com/demo.png')).toBe(false);
  });

  it('renders safe Markdown images with privacy-conscious attributes', () => {
    const html = renderToStaticMarkup(createElement(AssistantMessageContent, {
      content: '![分子结构](https://example.com/structure.png)',
    }));

    expect(html).toContain('<img');
    expect(html).toContain('src="https://example.com/structure.png"');
    expect(html).toContain('alt="分子结构"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });
});


describe('molecule rendering protocol', () => {
  it('round-trips charges, triple bonds, stereochemistry and branches without URL corruption', () => {
    for (const smiles of ['C#N','C[N+](C)(C)C','C/C=C\\C','CC(=O)Oc1ccccc1C(=O)O']) {
      const source=structureImageUrl(smiles);
      expect(source).not.toMatch(/[()#]/);
      expect(structureSmiles(source)).toBe(smiles);
    }
    expect(structureSmiles('/api/assistant/structure?smiles=[NH4+]')).toBe('[NH4+]');
  });
  it('renders SMILES blocks and legacy structure images as responsive cards, with no raw image URL', () => {
    for (const content of ['```smiles\nCC(=O)O\n```', '![乙酸](/api/assistant/structure?smiles=CC%28%3DO%29O)']) {
      const html=renderToStaticMarkup(createElement(AssistantMessageContent,{content}));
      expect(html).toContain('正在绘制结构'); expect(html).toContain('复制 SMILES'); expect(html).toContain('CC(=O)O');
      expect(html).not.toContain('src="/api/assistant/structure');
    }
  });
});
