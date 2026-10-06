import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { saveReceiptFile } from '@/lib/receipt-storage';
import { validateReceiptFile } from '@/lib/receipt-upload';

export const POST = withErrorHandler(async (request: NextRequest) => {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  if (!auth.labId) return NextResponse.json({ error: '当前用户未关联实验室' }, { status: 403 });

  const formData = await request.formData();
  const reagentId = String(formData.get('reagentId') || '').trim();
  const reagentLogId = String(formData.get('reagentLogId') || '').trim() || null;
  const archiveNote = String(formData.get('archiveNote') || '').trim();
  const receiptDateRaw = String(formData.get('receiptDate') || '').trim();
  const fileValue = formData.get('receipt');
  const receipt = fileValue instanceof File ? fileValue : null;
  if (!reagentId) return NextResponse.json({ error: '请选择关联试剂' }, { status: 400 });
  if (!receipt) return NextResponse.json({ error: '请选择要补录的票据' }, { status: 400 });
  const fileError = validateReceiptFile(receipt);
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

  const reagent = await prisma.reagent.findFirst({ where: { id: reagentId, labId: auth.labId } });
  if (!reagent) return NextResponse.json({ error: '试剂不存在或无权访问' }, { status: 404 });
  if (reagentLogId) {
    const log = await prisma.reagentLog.findFirst({
      where: { id: reagentLogId, reagentId, reagent: { labId: auth.labId } },
      select: { id: true },
    });
    if (!log) return NextResponse.json({ error: '所选入库记录与试剂不匹配' }, { status: 400 });
  }
  const receiptDate = receiptDateRaw ? new Date(`${receiptDateRaw}T00:00:00`) : new Date();
  if (Number.isNaN(receiptDate.getTime())) {
    return NextResponse.json({ error: '票据日期格式无效' }, { status: 400 });
  }

  const storedPath = await saveReceiptFile(receipt);
  try {
    const document = await prisma.document.create({
      data: {
        type: 'STOCK_IN',
        fileUrl: storedPath,
        fileName: receipt.name,
        mimeType: receipt.type,
        fileSize: receipt.size,
        status: 'CONFIRMED',
        processingMode: 'ARCHIVE_ONLY',
        receiptDate,
        archiveNote: archiveNote || '遗漏票据补录（未执行 OCR）',
        uploadedById: auth.userId,
        labId: auth.labId,
        reagentId,
        reagentLogId,
        reagentName: reagent.name,
        casNumber: reagent.casNumber,
        brand: reagent.brand,
        riskLevel: reagent.riskLevel,
        isHazardous: reagent.isHazardous,
        isControlled: reagent.isControlled,
      },
    });
    return NextResponse.json({ document, stockChanged: false }, { status: 201 });
  } catch (error) {
    // Preserve the original: a failed response does not prove the database commit failed.
    throw error;
  }
});
