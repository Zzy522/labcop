import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, parsePagination, paginatedResponse } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

interface LogEntry {
  id: string;
  type: string;
  typeLabel: string;
  operator: string;
  detail: string;
  createdAt: string;
  status?: string;
}

const REAGENT_LOG_ACTION_LABELS: Record<string, string> = {
  STOCK_IN: '入库',
  STOCK_OUT: '出库',
  ADJUST: '库存调整',
  ARCHIVE: '归档',
};

const REQUISITION_STATUS_LABELS: Record<string, string> = {
  PENDING: '待审批',
  APPROVED: '已通过',
  NEEDS_CONFIRM: '待确认',
  BLOCKED: '已阻断',
  REJECTED: '已拒绝',
};

const DEVICE_USAGE_STATUS_LABELS: Record<string, string> = {
  NORMAL: '正常',
  ABNORMAL: '异常',
  COMPLETED: '已完成',
};

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip } = parsePagination(searchParams);
  const type = searchParams.get('type') || undefined; // reagent | requisition | device
  const labId = authResult.labId;

  const fetchLimit = 100; // 各类最多拉取 100 条做合并
  const tasks: Promise<LogEntry[]>[] = [];

  // 试剂台账
  if (!type || type === 'reagent') {
    tasks.push(
      (async () => {
        const rows = await prisma.reagentLog.findMany({
          where: labId ? { reagent: { labId } } : undefined,
          include: {
            reagent: { select: { name: true } },
            operator: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
        });
        return rows.map((r) => ({
          id: r.id,
          type: 'reagent',
          typeLabel: '试剂台账',
          operator: r.operator?.name ?? '未知',
          detail: `${REAGENT_LOG_ACTION_LABELS[r.action] ?? r.action} ${r.reagent?.name ?? '试剂'} ×${r.quantity}${r.note ? `（${r.note}）` : ''}`,
          createdAt: r.createdAt.toISOString(),
        }));
      })()
    );
  }

  // 领用申请
  if (!type || type === 'requisition') {
    tasks.push(
      (async () => {
        const rows = await prisma.requisition.findMany({
          where: labId ? { reagent: { labId } } : undefined,
          include: {
            reagent: { select: { name: true } },
            applicant: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
        });
        return rows.map((r) => ({
          id: r.id,
          type: 'requisition',
          typeLabel: '领用申请',
          operator: r.applicant?.name ?? '未知',
          detail: `申请领用 ${r.reagent?.name ?? '试剂'} ×${r.quantity}${r.purpose ? `（${r.purpose}）` : ''}`,
          createdAt: r.createdAt.toISOString(),
          status: REQUISITION_STATUS_LABELS[r.status] ?? r.status,
        }));
      })()
    );
  }

  // 设备使用
  if (!type || type === 'device') {
    tasks.push(
      (async () => {
        const rows = await prisma.deviceUsage.findMany({
          where: labId ? { device: { labId } } : undefined,
          include: {
            device: { select: { name: true } },
            user: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: fetchLimit,
        });
        return rows.map((r) => ({
          id: r.id,
          type: 'device',
          typeLabel: '设备使用',
          operator: r.user?.name ?? '未知',
          detail: `使用 ${r.device?.name ?? '设备'}${r.purpose ? `（${r.purpose}）` : ''}`,
          createdAt: r.createdAt.toISOString(),
          status: DEVICE_USAGE_STATUS_LABELS[r.status] ?? r.status,
        }));
      })()
    );
  }

  // 合并所有日志结果
  const results = await Promise.all(tasks);
  const merged = results.flat().sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const total = merged.length;
  const paged = merged.slice(skip, skip + pageSize);

  return NextResponse.json(paginatedResponse(paged, total, page, pageSize));
});
