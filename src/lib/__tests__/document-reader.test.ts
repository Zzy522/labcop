import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zipSync, strToU8 } from 'fflate';

const run = promisify(execFile);
let folder: string;
beforeAll(async () => { folder = await mkdtemp(path.join(tmpdir(), 'document-reader-')); });
afterAll(async () => { await rm(folder, { recursive: true, force: true }); });
async function extract(name: string, data: Uint8Array | string) {
  const file = path.join(folder, name);
  await writeFile(file, data);
  const { stdout } = await run(process.execPath, ['scripts/document-reader.mjs', file, path.extname(file)], { timeout: 30000 });
  return JSON.parse(stdout) as { text: string; warning: string; truncated: boolean };
}
describe('真实文档抽取子进程', () => {
  it('DOCX 保留段落顺序和 XML 实体', async () => {
    const doc = zipSync({ 'word/document.xml': strToU8('<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>实验 A &amp; B</w:t></w:r></w:p><w:p><w:r><w:t>第二段</w:t></w:r></w:p></w:body></w:document>') });
    const result = await extract('test.docx', doc);
    expect(result.text).toContain('实验 A & B\n第二段');
    expect(result.warning).toContain('只读取文字');
  });
  it('PPTX 使用演示顺序而非文件名顺序', async () => {
    const ppt = zipSync({
      'ppt/presentation.xml': strToU8('<p:presentation><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>'),
      'ppt/_rels/presentation.xml.rels': strToU8('<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>'),
      'ppt/slides/slide1.xml': strToU8('<p:sld><a:p><a:r><a:t>Later</a:t></a:r></a:p></p:sld>'),
      'ppt/slides/slide2.xml': strToU8('<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>'),
    });
    const result = await extract('test.pptx', ppt);
    expect(result.text.indexOf('First')).toBeLessThan(result.text.indexOf('Later'));
    expect(result.text).toContain('[幻灯片 2]');
  });
  it('拒绝伪装文档和 DTD，文本截断明确报告', async () => {
    await expect(extract('fake.pdf', 'not pdf')).rejects.toThrow();
    await expect(extract('dtd.docx', zipSync({ 'word/document.xml': strToU8('<!DOCTYPE x [<!ENTITY x "abc">]><w:document>&x;</w:document>') }))).rejects.toThrow();
    const result = await extract('long.txt', '文本'.repeat(70000));
    expect(result.text.length).toBe(120000);
    expect(result.truncated).toBe(true);
  });
  it('读取真实 PDF 文字层并保留页码', async () => {
    const stream = 'BT /F1 12 Tf 72 700 Td (Hello research) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    const result = await extract('test.pdf', pdf);
    expect(result.text).toContain('Hello research');
    expect(result.text).toContain('[第 1 页]');
  });
});
