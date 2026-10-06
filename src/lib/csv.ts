/**
 * 轻量 CSV 工具（零依赖）
 *
 * - parseCsv：解析 CSV 文本为二维数组，支持引号包裹、双引号转义、CRLF
 * - toCsv：二维数组序列化为 CSV 文本
 *
 * 用于试剂/化合物批量导入：模板下载 + 上传解析。
 * 不依赖 xlsx，避免引入额外二进制依赖；CSV 可被 Excel/WPS 直接打开。
 */

/** 解析 CSV 文本为行数组（自动过滤全空行） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += c;
      }
    }
  }
  // 处理最后一行（无尾换行）
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 过滤全空行
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** 转义单个字段（含逗号/引号/换行时用引号包裹） */
function escapeCsvField(f: string): string {
  if (/[",\n]/.test(f)) {
    return '"' + f.replace(/"/g, '""') + '"';
  }
  return f;
}

/** 二维数组转 CSV 文本 */
export function toCsv(rows: string[][]): string {
  return rows.map((r) => r.map(escapeCsvField).join(',')).join('\n') + '\n';
}

/** 将"是/true/1/yes"等统一解析为布尔值 */
export function parseBool(v: string): boolean {
  return /^(true|1|yes|是|y)$/i.test(v.trim());
}

/** 安全解析数字，失败返回 undefined */
export function parseNumber(v: string): number | undefined {
  const t = v.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}
