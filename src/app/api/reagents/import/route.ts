import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { createReagentSchema } from '@/lib/validations/reagent';
import { reagentService } from '@/lib/services';
import { parseCsv, toCsv, parseBool, parseNumber } from '@/lib/csv';

/**
 * 试剂批量导入
 * - GET  /api/reagents/import  下载 CSV 模板
 * - POST /api/reagents/import  上传 CSV 文本，逐行校验并创建
 *
 * 仅管理员可导入。强制 labId = 当前管理员所在实验室。
 */

const HEADERS = [
  'name', 'casNumber', 'specification', 'brand', 'dangerCategory',
  'riskLevel', 'isHazardous', 'isControlled', 'storageLocation',
  'stockQuantity', 'minStock', 'unit', 'batchNumber', 'expiryDate', 'smiles',
];

const TEMPLATE_ROWS: string[][] = [
  HEADERS,
  ['无水乙醇', '64-17-5', 'AR 500mL/瓶', '国药', '易燃', 'HIGH', '是', '否', '试剂柜A-1', '10', '2', '瓶', 'B20260101', '2027-12-31', 'CCO'],
  ['氢氧化钠', '1310-73-2', 'AR 500g/瓶', '西陇', '腐蚀', 'HIGH', '是', '否', '腐蚀品柜B-2', '5', '1', '瓶', '', '', '[Na+].[OH-]'],
];

export const GET = withErrorHandler(async () => {
  // 模板下载无需鉴权也可，但保持一致需登录
  const csv = '\ufeff' + toCsv(TEMPLATE_ROWS); // BOM 便于 Excel 识别 UTF-8
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="reagents-template.csv"',
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

  // 校验必要列
  const missing = ['name', 'specification', 'storageLocation'].filter((h) => !(h in colIndex));
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
      casNumber: get('casNumber'),
      specification: get('specification'),
      brand: get('brand'),
      dangerCategory: get('dangerCategory'),
      riskLevel: (get('riskLevel') || 'LOW').toUpperCase() as 'LOW' | 'HIGH',
      isHazardous: parseBool(get('isHazardous')),
      isControlled: parseBool(get('isControlled')),
      storageLocation: get('storageLocation'),
      stockQuantity: parseNumber(get('stockQuantity')) ?? 0,
      minStock: parseNumber(get('minStock')) ?? 0,
      unit: get('unit'),
      batchNumber: get('batchNumber'),
      expiryDate: get('expiryDate') || null,
      smiles: get('smiles'),
      labId: authResult.labId!,
    };

    const parsed = createReagentSchema.safeParse(obj);
    if (!parsed.success) {
      failures.push({
        row: i + 2, // +2: 表头占第 1 行，数据从第 2 行起
        error: Object.values(parsed.error.flatten().fieldErrors).flat().join('；') || '校验失败',
      });
      continue;
    }

    try {
      await reagentService.createReagent(parsed.data, authResult.userId);
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
