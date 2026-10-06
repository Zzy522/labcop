/**
 * 通用 CSV 导出工具
 */

function escapeCSV(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(escapeCSV).join(',');
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCSV(row[h])).join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}

export function downloadCSV(filename: string, headers: string[], rows: Record<string, unknown>[]) {
  const csv = toCSV(headers, rows);
  const BOM = '\uFEFF'; // UTF-8 BOM 确保 Excel 正确识别中文
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
