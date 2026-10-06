import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

function renderTabs(props: { value?: string; defaultValue?: string }) {
  return renderToStaticMarkup(h(Tabs, props,
    h(TabsList, null,
      h(TabsTrigger, { value: 'batches' }, '合成批次 (1)'),
      h(TabsTrigger, { value: 'assays' }, '生物活性 (1)')),
    h(TabsContent, { value: 'batches' }, 'BATCH-RECORD'),
    h(TabsContent, { value: 'assays' }, 'ASSAY-RECORD')));
}

describe('compound record tabs', () => {
  it('renders both labels and the default batch record', () => {
    const html = renderTabs({ defaultValue: 'batches' });
    expect(html).toContain('合成批次 (1)');
    expect(html).toContain('生物活性 (1)');
    expect(html).toContain('BATCH-RECORD');
    expect(html).not.toContain('ASSAY-RECORD');
  });
  it('selects the requested record panel by its value', () => {
    const html = renderTabs({ value: 'assays' });
    expect(html).toContain('ASSAY-RECORD');
    expect(html).not.toContain('BATCH-RECORD');
  });
});
