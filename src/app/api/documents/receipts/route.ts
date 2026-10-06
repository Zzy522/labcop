import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { parsePagination, paginatedResponse, withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { isStoredReceiptPath } from '@/lib/receipt-storage';

function parseStartDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseEndDateExclusive(value: string | null): Date | undefined {
  const start = parseStartDate(value);
  if (!start) return undefined;
  start.setDate(start.getDate() + 1);
  return start;
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip } = parsePagination(searchParams, 20, 100);
  const query = searchParams.get('query')?.trim();
  const uploadedById = searchParams.get('uploadedById') || undefined;
  const riskLevel = searchParams.get('riskLevel') || undefined;
  const status = searchParams.get('status') || undefined;
  const processingMode = searchParams.get('processingMode') || undefined;
  const hazardousParam = searchParams.get('isHazardous');
  const controlledParam = searchParams.get('isControlled');
  const startDate = parseStartDate(searchParams.get('startDate'));
  const endDate = parseEndDateExclusive(searchParams.get('endDate'));

  const where = {
    labId: authResult.labId,
    type: 'STOCK_IN',
    ...(uploadedById ? { uploadedById } : {}),
    ...(riskLevel ? { riskLevel } : {}),
    ...(status ? { status } : {}),
    ...(processingMode ? { processingMode } : {}),
    ...(hazardousParam === 'true' ? { isHazardous: true } : hazardousParam === 'false' ? { isHazardous: false } : {}),
    ...(controlledParam === 'true' ? { isControlled: true } : controlledParam === 'false' ? { isControlled: false } : {}),
    ...(startDate || endDate
      ? { createdAt: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lt: endDate } : {}) } }
      : {}),
    ...(query
      ? {
          OR: [
            { reagentName: { contains: query } },
            { casNumber: { contains: query } },
            { brand: { contains: query } },
            { fileName: { contains: query } },
          ],
        }
      : {}),
  };

  const [documents, total, uploaders] = await Promise.all([
    prisma.document.findMany({
      where,
      include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.document.count({ where }),
    prisma.user.findMany({
      where: { documents: { some: { labId: authResult.labId, type: 'STOCK_IN' } } },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const data = documents.map((document) => ({
    id: document.id,
    fileName: document.fileName,
    mimeType: document.mimeType,
    fileSize: document.fileSize,
    status: document.status,
    processingMode: document.processingMode,
    receiptDate: document.receiptDate?.toISOString() ?? null,
    archiveNote: document.archiveNote,
    reagentId: document.reagentId,
    reagentName: document.reagentName,
    casNumber: document.casNumber,
    brand: document.brand,
    riskLevel: document.riskLevel,
    isHazardous: document.isHazardous,
    isControlled: document.isControlled,
    uploadedBy: document.uploadedBy,
    createdAt: document.createdAt.toISOString(),
    hasOriginal: isStoredReceiptPath(document.fileUrl),
  }));

  return NextResponse.json({
    ...paginatedResponse(data, total, page, pageSize),
    filterOptions: { uploaders },
  });
});
