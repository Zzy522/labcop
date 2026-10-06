import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';

/**
 * GET /api/reports/export?type=reagents|devices|requisitions|risk-events
 * 导出台账数据为 CSV 格式
 */
export async function GET(request: NextRequest) {
  // 认证：导出数据需要管理员权限
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  // 数据隔离：必须有 labId
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室，无法导出报表' }, { status: 403 });
  }
  const labId = authResult.labId;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');

    const validTypes = ['reagents', 'devices', 'requisitions', 'risk-events'] as const;
    if (!type || !validTypes.includes(type as typeof validTypes[number])) {
      return NextResponse.json(
        { error: '无效的导出类型，支持: reagents, devices, requisitions, risk-events' },
        { status: 400 }
      );
    }

    let csvContent: string;
    let fileName: string;

    switch (type) {
      case 'reagents': {
        const data = await prisma.reagent.findMany({
          where: { labId },
          include: {
            lab: { select: { name: true, location: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        const headers = ['试剂名称', 'CAS号', '规格', '品牌', '危险类别', '风险等级', '是否危化品', '存储位置', '当前库存', '最低库存', '单位', '批号', '有效期', '所属实验室'];
        const rows = data.map((r: typeof data[number]) => [
          r.name,
          r.casNumber ?? '',
          r.specification ?? '',
          r.brand ?? '',
          r.dangerCategory ?? '',
          r.riskLevel,
          r.isHazardous ? '是' : '否',
          r.storageLocation ?? '',
          String(r.stockQuantity),
          String(r.minStock),
          r.unit ?? '',
          r.batchNumber ?? '',
          r.expiryDate ? new Date(r.expiryDate).toLocaleDateString('zh-CN') : '',
          r.lab.name,
        ]);

        csvContent = toCsv(headers, rows);
        fileName = `试剂台账_${formatDate(new Date())}.csv`;
        break;
      }

      case 'devices': {
        const data = await prisma.device.findMany({
          where: { labId },
          include: {
            lab: { select: { name: true, location: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        const headers = ['设备名称', '型号', '序列号', '位置', '风险等级', '状态', '所属实验室', '创建时间'];
        const rows = data.map((d: typeof data[number]) => [
          d.name,
          d.model ?? '',
          d.serialNumber ?? '',
          d.location ?? '',
          d.riskLevel,
          d.status,
          d.lab.name,
          new Date(d.createdAt).toLocaleDateString('zh-CN'),
        ]);

        csvContent = toCsv(headers, rows);
        fileName = `设备台账_${formatDate(new Date())}.csv`;
        break;
      }

      case 'requisitions': {
        const data = await prisma.requisition.findMany({
          where: { labId },
          include: {
            reagent: { select: { name: true } },
            applicant: { select: { name: true } },
            reviewer: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        const headers = ['试剂名称', '申请人', '申请数量', '用途', '状态', '审查人', '审查时间', '申请时间'];
        const rows = data.map((r: typeof data[number]) => [
          r.reagent.name,
          r.applicant.name,
          String(r.quantity),
          r.purpose ?? '',
          r.status,
          r.reviewer?.name ?? '',
          r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString('zh-CN') : '',
          new Date(r.createdAt).toLocaleDateString('zh-CN'),
        ]);

        csvContent = toCsv(headers, rows);
        fileName = `领用记录_${formatDate(new Date())}.csv`;
        break;
      }

      case 'risk-events': {
        const data = await prisma.riskEvent.findMany({
          where: { labId },
          include: {
            reagent: { select: { name: true } },
            device: { select: { name: true } },
            resolvedBy: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

        const headers = ['事件类型', '级别', '描述', '关联试剂', '关联设备', '是否已解决', '解决人', '解决时间', '创建时间'];
        const rows = data.map((r: typeof data[number]) => [
          r.type,
          r.level,
          r.description,
          r.reagent?.name ?? '',
          r.device?.name ?? '',
          r.isResolved ? '是' : '否',
          r.resolvedBy?.name ?? '',
          r.resolvedAt ? new Date(r.resolvedAt).toLocaleDateString('zh-CN') : '',
          new Date(r.createdAt).toLocaleDateString('zh-CN'),
        ]);

        csvContent = toCsv(headers, rows);
        fileName = `风险事件_${formatDate(new Date())}.csv`;
        break;
      }

      default:
        return NextResponse.json(
          { error: '不支持的导出类型' },
          { status: 400 }
        );
    }

    // 添加 BOM 头以确保 Excel 正确识别 UTF-8 编码
    const bom = '\uFEFF';
    const buffer = Buffer.from(bom + csvContent, 'utf-8');

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    console.error('导出报表失败:', error);
    return NextResponse.json(
      { error: '导出报表失败' },
      { status: 500 }
    );
  }
}

/**
 * 将表头和行数据转换为 CSV 字符串
 */
function toCsv(headers: string[], rows: string[][]): string {
  const escapeCsvField = (field: string): string => {
    // 如果字段包含逗号、引号或换行，用双引号包裹并转义内部引号
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  };

  const headerLine = headers.map(escapeCsvField).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvField).join(','));
  return [headerLine, ...dataLines].join('\n');
}

/**
 * 格式化日期为 YYYYMMDD 格式（用于文件名）
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
