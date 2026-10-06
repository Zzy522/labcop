// Isolated, bounded document extraction process. Never execute document scripts/macros.
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const MAX_TEXT = 120000;
console.log = console.warn = (...args) => process.stderr.write(args.join(' ') + '\n');
const [filePath, extension] = process.argv.slice(2);
const buffer = await readFile(filePath);
if (buffer.length > 10 * 1024 * 1024) throw new Error('文件超过 10MB');
let text = '';
let warning = '只读取文字；嵌入图片、图表、公式和复杂排版可能未被解析。';
if (['.txt', '.md', '.csv'].includes(extension)) {
  text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  if (text.includes('\0')) throw new Error('不是有效的 UTF-8 文本');
  warning = '';
} else if (extension === '.pdf') {
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('无效的 PDF 文件');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
  try {
    const doc = await loading.promise;
    if (doc.numPages > 100) throw new Error('PDF 超过 100 页，请拆分后上传');
    for (let i = 1; i <= doc.numPages && text.length <= MAX_TEXT; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += `\n[第 ${i} 页]\n` + content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
      page.cleanup();
    }
  } finally { await loading.destroy(); }
  if (!text.replace(/\[第 \d+ 页\]/g, '').trim()) throw new Error('未找到文字层，扫描 PDF 请先 OCR 或上传页面截图进行视觉分析');
} else if (extension === '.docx' || extension === '.pptx') {
  let total = 0;
  let count = 0;
  const files = unzipSync(buffer, { filter(entry) {
    if (++count > 3000) throw new Error('压缩包条目过多');
    const selected = extension === '.docx' ? entry.name === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(entry.name) || ['ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'].includes(entry.name);
    if (!selected) return false;
    total += entry.originalSize;
    if (entry.originalSize > 8 * 1024 * 1024 || total > 24 * 1024 * 1024) throw new Error('文档解压体积过大');
    return true;
  } });
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: true, parseTagValue: false, processEntities: true });
  function collect(nodes) {
    let out = '';
    for (const node of nodes) for (const [tag, value] of Object.entries(node)) {
      if (tag === '#text') out += String(value);
      else if (Array.isArray(value)) out += collect(value) + (/^(w|a):p$/.test(tag) ? '\n' : '');
      else if (tag === 'w:tab') out += '\t';
    }
    return out;
  }
  let names = Object.keys(files);
  if (extension === '.pptx') {
    const meta = new XMLParser({ ignoreAttributes: false });
    const xml = strFromU8(files['ppt/presentation.xml'] || new Uint8Array());
    const relsXml = strFromU8(files['ppt/_rels/presentation.xml.rels'] || new Uint8Array());
    if (/<!DOCTYPE|<!ENTITY/i.test(xml + relsXml)) throw new Error('不支持 DTD');
    const asList = value => value ? Array.isArray(value) ? value : [value] : [];
    const slides = asList(meta.parse(xml)?.['p:presentation']?.['p:sldIdLst']?.['p:sldId']);
    const rels = asList(meta.parse(relsXml)?.Relationships?.Relationship);
    names = slides.map(slide => {
      const rel = rels.find(rel => rel['@_Id'] === slide['@_r:id']);
      if (!rel || rel['@_TargetMode'] === 'External') throw new Error('无效的幻灯片关系');
      const name = rel['@_Target'].startsWith('/') ? rel['@_Target'].slice(1) : 'ppt/' + rel['@_Target'];
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(name) || !files[name]) throw new Error('缺少幻灯片内容');
      return name;
    });
  }
  if (!names.length) throw new Error('文件内容与扩展名不匹配');
  for (const [index, name] of names.entries()) {
    const xml = strFromU8(files[name]);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持包含 DTD 或实体声明的文档');
    text += (extension === '.pptx' ? `\n[幻灯片 ${index + 1}]\n` : '') + collect(parser.parse(xml));
    if (text.length > MAX_TEXT) break;
  }
  if (!text.replace(/\[幻灯片 \d+\]/g, '').trim()) throw new Error('未抽取到正文；图片型文档请上传截图进行视觉分析');
} else throw new Error('请使用 DOCX、PPTX、PDF 或 UTF-8 文本；旧版 DOC/PPT 请先另存为新版格式');
const truncated = text.length > MAX_TEXT;
process.stdout.write(JSON.stringify({ text: text.slice(0, MAX_TEXT), warning: `${warning}${truncated ? '正文超过 12 万字符，已截断。' : ''}`, truncated }));
