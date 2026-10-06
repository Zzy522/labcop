import { createHash } from 'node:crypto';
import { idempotentTransaction, requireIdempotencyKey, requestDigest } from '@/lib/idempotency';
import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { createReagentSchema } from '@/lib/validations/reagent';
import { parseSpecification } from '@/lib/reagent-units';
import { saveReceiptFile } from '@/lib/receipt-storage';
import { validateReceiptFile } from '@/lib/receipt-upload';

export const POST = withErrorHandler(async (request: NextRequest) => {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  if (!auth.labId) {
    return NextResponse.json({ error: '当前用户未关联实验室' }, { status: 403 });
  }

  const requestKey = requireIdempotencyKey(request);
  const formData = await request.formData();
  const reagentJson = formData.get('reagent');
  const noReceipt = formData.get('noReceipt') === 'true';
  const noReceiptReason = String(formData.get('noReceiptReason') || '').trim();
  const receiptDateRaw = String(formData.get('receiptDate') || '').trim();
  const fileValue = formData.get('receipt');
  const receipt = !noReceipt && fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

  if (typeof reagentJson !== 'string') {
    return NextResponse.json({ error: '缺少试剂信息' }, { status: 400 });
  }
  let input: unknown;
  try {
    input = JSON.parse(reagentJson);
  } catch {
    return NextResponse.json({ error: '试剂信息格式无效' }, { status: 400 });
  }
  const parsed = createReagentSchema.safeParse({
    ...(input as Record<string, unknown>),
    labId: auth.labId,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: '请完善入库信息：' + [...new Set(parsed.error.issues.map(issue => issue.message))].join('；'), details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  if (noReceipt) {
    if (noReceiptReason.length < 4) {
      return NextResponse.json({ error: '非采购无票据入库请填写至少 4 个字的原因' }, { status: 400 });
    }
  } else if (!receipt) {
    return NextResponse.json({ error: '采购入库必须上传原始票据' }, { status: 400 });
  }
  if (receipt) {
    const fileError = validateReceiptFile(receipt);
    if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });
  }

  const receiptDate = receiptDateRaw ? new Date(`${receiptDateRaw}T00:00:00`) : new Date();
  if (Number.isNaN(receiptDate.getTime())) {
    return NextResponse.json({ error: '票据日期格式无效' }, { status: 400 });
  }

  let storedPath: string | null = null;
  try {
    const data = parsed.data;
    const specification = parseSpecification(data.specification);
    const result = await idempotentTransaction({ labId: auth.labId, userId: auth.userId, operation: 'MANUAL_STOCK_IN', key: requestKey, digest: requestDigest({ data, noReceipt, noReceiptReason, receiptDateRaw, fileHash: receipt ? createHash('sha256').update(Buffer.from(await receipt.arrayBuffer())).digest('hex') : null, fileName: receipt?.name }) }, async (tx) => {
      if (receipt) storedPath = await saveReceiptFile(receipt);
      const reagent = await tx.reagent.create({
        data: {
          name: data.name,
          casNumber: data.casNumber || null,
          specification: data.specification || null,
          brand: data.brand || null,
          dangerCategory: data.dangerCategory || null,
          riskLevel: data.riskLevel,
          isHazardous: data.isHazardous,
          isControlled: data.isControlled,
          storageLocation: data.storageLocation || null,
          stockQuantity: data.stockQuantity,
          totalStockedBottles: data.stockQuantity,
          minStock: data.minStock,
          unit: data.unit || null,
          capacityPerUnit: specification?.capacityPerUnit ?? null,
          capacityUnit: specification?.capacityUnit ?? null,
          batchNumber: data.batchNumber || null,
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
          smiles: data.smiles || null,
          labId: auth.labId!,
          stockInDate: new Date(),
          stockInOperatorId: auth.userId,
        },
      });
      const log = await tx.reagentLog.create({
        data: {
          reagentId: reagent.id,
          action: 'STOCK_IN',
          quantity: data.stockQuantity,
          operatorId: auth.userId,
          note: noReceipt ? `非采购入库（无票据）：${noReceiptReason}` : '手工录入并归档票据',
        },
      });
      const document = storedPath && receipt
        ? await tx.document.create({
            data: {
              type: 'STOCK_IN',
              fileUrl: storedPath,
              fileName: receipt.name,
              mimeType: receipt.type,
              fileSize: receipt.size,
              status: 'CONFIRMED',
              processingMode: 'MANUAL_ARCHIVE',
              receiptDate,
              uploadedById: auth.userId,
              labId: auth.labId,
              reagentId: reagent.id,
              reagentLogId: log.id,
              reagentName: reagent.name,
              casNumber: reagent.casNumber,
              brand: reagent.brand,
              riskLevel: reagent.riskLevel,
              isHazardous: reagent.isHazardous,
              isControlled: reagent.isControlled,
            },
          })
        : null;
      return { reagent, reagentLogId: log.id, documentId: document?.id ?? null };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    // Preserve originals after an ambiguous commit; reconcile orphan files instead of deleting them.
    throw error;
  }
});
