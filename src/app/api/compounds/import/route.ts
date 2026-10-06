import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { importCompoundSchema } from '@/lib/validations/compound';
import { compoundService } from '@/lib/services';
import { parseCsv, toCsv, parseNumber } from '@/lib/csv';

/**
 * 化合物批量导入
 * - GET  /api/compounds/import  下载 CSV 模板
 * - POST /api/compounds/import  上传 CSV 文本，逐行校验并创建（含同步入库）
 *
 * 仅管理员可导入。强制 labId = 当前管理员所在实验室。
 */

const HEADERS = [
  'name', 'commonName', 'casNumber', 'smiles', 'molecularFormula', 'molecularWeight',
  'source', 'status', 'stockQuantity', 'stockUnit', 'purity', 'storageLocation', 'synthesisNote',
];

const TEMPLATE_ROWS: string[][] = [
  HEADERS,
  ['XY-001', '阿司匹林', '50-78-2', 'CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4', '180.16', 'SYNTHESIZED', 'ACTIVE', '5', 'g', '98%', '试剂柜A-1', ''],
  ['XY-002', '咖啡因', '58-08-2', 'Cn1c(=O)c2c(ncn2C)n(C)c1=O', 'C8H10N4O2', '194.19', 'PURCHASED', 'ACTIVE', '10', 'g', 'AR级', '试剂柜A-2', ''],
];

export const GET = withErrorHandler(async () => {
  const csv = '\ufeff' + toCsv(TEMPLATE_ROWS);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="compounds-template.csv"',
    },
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const body = await request.json();
  const csv: string = body?.csv;
  if (!csv || typeof csv !== 'string') {
    return NextResponse.json({ error: '请提供 CSV 文本' }, { status: 400 });
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return NextResponse.json({ error: 'CSV 无数据行（需含表头 + 至少一行数据）' }, { status: 400 });
  }

  const headerRow = rows[0].map((h) => h.trim());
  const colIndex: Record<string, number> = {};
  headerRow.forEach((h, i) => { colIndex[h] = i; });

  const missing = ['name', 'smiles', 'stockQuantity', 'stockUnit', 'storageLocation'].filter(
    (h) => !(h in colIndex)
  );
  if (missing.length) {
    return NextResponse.json({ error: `模板缺少必要列：${missing.join(', ')}` }, { status: 400 });
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > 500) {
    return NextResponse.json({ error: '单次最多导入 500 行' }, { status: 400 });
  }

  const failures: Array<{ row: number; error: string }> = [];
  let success = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const get = (key: string): string => {
      const idx = colIndex[key];
      return idx !== undefined ? (r[idx] ?? '').trim() : '';
    };

    const obj = {
      name: get('name'),
      commonName: get('commonName') || undefined,
      casNumber: get('casNumber') || undefined,
      smiles: get('smiles'),
      molecularFormula: get('molecularFormula') || undefined,
      molecularWeight: parseNumber(get('molecularWeight')),
      source: (get('source') || 'SYNTHESIZED').toUpperCase(),
      status: (get('status') || 'ACTIVE').toUpperCase(),
      stockQuantity: parseNumber(get('stockQuantity')),
      stockUnit: get('stockUnit'),
      purity: get('purity') || undefined,
      storageLocation: get('storageLocation'),
      synthesisNote: get('synthesisNote') || undefined,
    };

    const parsed = importCompoundSchema.safeParse(obj);
    if (!parsed.success) {
      failures.push({
        row: i + 2,
        error: Object.values(parsed.error.flatten().fieldErrors).flat().join('；') || '校验失败',
      });
      continue;
    }

    try {
      await compoundService.createCompound(parsed.data, authResult.labId!, authResult.userId);
      success++;
    } catch (e) {
      failures.push({
        row: i + 2,
        error: e instanceof Error ? e.message : '创建失败',
      });
    }
  }

  return NextResponse.json({
    data: { success, total: dataRows.length, failed: failures.length, failures },
  });
});
