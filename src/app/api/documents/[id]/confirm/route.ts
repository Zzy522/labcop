import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod/v4';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { isReceiptRecognitionResult } from '@/lib/receipt-ocr';
import { parseSpecification } from '@/lib/reagent-units';
import { getPubChemReagentFields, lookupPubChemByCas, type PubChemCompoundInfo } from '@/lib/pubchem-server';
import { isValidCasNumber } from '@/lib/cas-number';

interface RouteParams { params: Promise<{ id: string }> }

const itemIndexSchema = z.number().int().min(0);
const reagentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  casNumber: z.string().trim().refine(
    (value) => !value || isValidCasNumber(value),
    'CAS 号格式或校验位不正确，请根据票据原图核对'
  ).optional().default(''),
  specification: z.string().trim().min(1),
  remarks: z.string().trim().max(1000).optional().default(''),
  brand: z.string().trim().optional().default(''),
  dangerCategory: z.string().trim().optional().default(''),
  riskLevel: z.enum(['LOW', 'HIGH']),
  isHazardous: z.boolean(),
  isControlled: z.boolean(),
  storageLocation: z.string().trim().min(1),
  stockQuantity: z.number().int().min(1),
  unit: z.string().trim().min(1).default('瓶'),
  batchNumber: z.string().trim().optional().default(''),
});
const confirmSchema = z.union([
  z.object({ itemIndex: itemIndexSchema, action: z.literal('SKIP') }),
  z.object({ itemIndex: itemIndexSchema, action: z.literal('CONFIRM').optional().default('CONFIRM'), reagent: reagentSchema }),
]);

function documentStatus(items: Array<{ confirmationStatus: string }>): 'PENDING' | 'CONFIRMED' | 'SKIPPED' {
  if (items.some((item) => item.confirmationStatus === 'PENDING')) return 'PENDING';
  return items.some((item) => item.confirmationStatus === 'CONFIRMED') ? 'CONFIRMED' : 'SKIPPED';
}

export const PATCH = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  if (!auth.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  const labId = auth.labId;
  const userId = auth.userId;
  const parsed = confirmSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: '票据处理信息不完整', details: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  const input = parsed.data;

  // 先校验归属和条目状态，再决定是否需要访问 PubChem，避免对无权票据发起外部查询。
  const existingDocument = await prisma.document.findFirst({
    where: { id, labId, uploadedById: userId, type: 'STOCK_IN', processingMode: 'OCR' },
    select: { recognitionResult: true },
  });
  if (!existingDocument) return NextResponse.json({ error: '票据不存在或无权处理' }, { status: 404 });
  if (!isReceiptRecognitionResult(existingDocument.recognitionResult)) {
    return NextResponse.json({ error: '票据识别结果格式过旧，请重新上传识别' }, { status: 409 });
  }
  const existingItem = existingDocument.recognitionResult.items[input.itemIndex];
  if (!existingItem) return NextResponse.json({ error: '待处理条目不存在' }, { status: 404 });

  if (input.action === 'SKIP') {
    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.document.findFirst({
        where: { id, labId, uploadedById: userId, type: 'STOCK_IN', processingMode: 'OCR' },
        select: { recognitionResult: true },
      });
      if (!document || !isReceiptRecognitionResult(document.recognitionResult)) return { error: '票据状态已变化', status: 409 as const };
      const recognition = structuredClone(document.recognitionResult);
      const item = recognition.items[input.itemIndex];
      if (!item) return { error: '待处理条目不存在', status: 404 as const };
      if (item.confirmationStatus === 'CONFIRMED') return { error: '该条目已经确认入库，不能再选择不入库', status: 409 as const };
      if (item.confirmationStatus === 'SKIPPED') return { alreadySkipped: true };

      recognition.items[input.itemIndex] = {
        ...item,
        confirmationStatus: 'SKIPPED',
        skippedAt: new Date().toISOString(),
      };
      await tx.document.update({
        where: { id },
        data: {
          recognitionResult: JSON.parse(JSON.stringify(recognition)),
          status: documentStatus(recognition.items),
        },
      });
      return { alreadySkipped: false };
    });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ data: result, message: result.alreadySkipped ? '该条目已选择不入库' : '已跳过该条目，不会写入试剂库' });
  }

  if (existingItem.confirmationStatus === 'SKIPPED') {
    return NextResponse.json({ error: '该条目已选择不入库' }, { status: 409 });
  }
  if (existingItem.confirmationStatus === 'CONFIRMED' && existingItem.reagentId) {
    return NextResponse.json({ data: { reagentId: existingItem.reagentId, alreadyConfirmed: true }, message: '该条目已经入库' });
  }

  const confirmedCapacity = parseSpecification(input.reagent.specification);
  if (!confirmedCapacity) {
    return NextResponse.json({ error: '规格必须包含可计算的数字和单位，例如 500mL/瓶、100g/瓶或 10mg/支' }, { status: 400 });
  }

  // 只在用户确认后，按用户最终核对过的 CAS 查询 PubChem；失败不阻断人工确认入库。
  let pubchem: PubChemCompoundInfo | null = null;
  let pubchemStatus: 'ok' | 'not_found' | 'error' | 'skipped' = 'skipped';
  let pubchemWarning: string | undefined;
  if (input.reagent.casNumber) {
    try {
      pubchem = await lookupPubChemByCas(input.reagent.casNumber);
      pubchemStatus = pubchem ? 'ok' : 'not_found';
      if (!pubchem) pubchemWarning = `PubChem 未找到 CAS 号「${input.reagent.casNumber}」，已按人工核对信息入库`;
    } catch (error) {
      pubchemStatus = 'error';
      pubchemWarning = `${error instanceof Error ? error.message : 'PubChem 查询失败'}，已按人工核对信息入库`;
    }
  }
  const pubchemFields = getPubChemReagentFields(pubchem);
  if (pubchemStatus === 'ok' && pubchemFields.missingLabels.length > 0) {
    pubchemWarning = `PubChem 未返回${pubchemFields.missingLabels.join('、')}，对应字段已留空`;
  }
  const reagentInput = {
    ...input.reagent,
    name: input.reagent.name || pubchem?.title || pubchem?.iupacName || '',
    molecularFormula: pubchemFields.molecularFormula,
    molecularWeight: pubchemFields.molecularWeight,
    iupacName: pubchemFields.iupacName,
    smiles: pubchemFields.smiles,
    structureImgUrl: pubchemFields.structureImgUrl,
  };

  const result = await prisma.$transaction(async (tx) => {
    const document = await tx.document.findFirst({
      where: { id, labId, uploadedById: userId, type: 'STOCK_IN', processingMode: 'OCR' },
      select: { recognitionResult: true },
    });
    if (!document || !isReceiptRecognitionResult(document.recognitionResult)) return { error: '票据状态已变化', status: 409 as const };
    const recognition = structuredClone(document.recognitionResult);
    const item = recognition.items[input.itemIndex];
    if (!item) return { error: '待确认条目不存在', status: 404 as const };
    if (item.confirmationStatus === 'CONFIRMED' && item.reagentId) return { reagentId: item.reagentId, alreadyConfirmed: true };
    if (item.confirmationStatus === 'SKIPPED') return { error: '该条目已选择不入库', status: 409 as const };

    const reagent = await tx.reagent.create({
      data: {
        name: reagentInput.name,
        casNumber: reagentInput.casNumber || null,
        specification: reagentInput.specification,
        // 复用既有 purity 字段保存浓度/纯度备注，避免包装规格参与错误换算。
        purity: reagentInput.remarks || null,
        brand: reagentInput.brand || null,
        dangerCategory: reagentInput.dangerCategory || null,
        riskLevel: reagentInput.riskLevel,
        isHazardous: reagentInput.isHazardous,
        isControlled: reagentInput.isControlled,
        storageLocation: reagentInput.storageLocation,
        stockQuantity: reagentInput.stockQuantity,
        totalStockedBottles: reagentInput.stockQuantity,
        minStock: 0,
        unit: reagentInput.unit,
        capacityPerUnit: confirmedCapacity.capacityPerUnit,
        capacityUnit: confirmedCapacity.capacityUnit,
        batchNumber: reagentInput.batchNumber || null,
        molecularFormula: reagentInput.molecularFormula || null,
        molecularWeight: reagentInput.molecularWeight || null,
        iupacName: reagentInput.iupacName || null,
        smiles: reagentInput.smiles || null,
        structureImgUrl: reagentInput.structureImgUrl || null,
        labId,
        stockInDate: new Date(),
        stockInOperatorId: userId,
      },
    });
    const reagentLog = await tx.reagentLog.create({
      data: { reagentId: reagent.id, action: 'STOCK_IN', quantity: reagentInput.stockQuantity, operatorId: userId, note: `OCR 票据入库：${id}` },
    });
    // Next.js 开发热更新可能仍持有 Schema 变更前的 Prisma Client 实例。
    // delegate 存在时走类型安全 API；旧实例则在同一事务内参数化写入，避免 undefined.create。
    const documentReagentDelegate = (tx as unknown as {
      documentReagent?: { create: (args: { data: { documentId: string; reagentId: string; itemIndex: number } }) => Promise<unknown> };
    }).documentReagent;
    if (documentReagentDelegate) {
      await documentReagentDelegate.create({
        data: { documentId: id, reagentId: reagent.id, itemIndex: input.itemIndex },
      });
    } else {
      await tx.$executeRaw`
        INSERT INTO "DocumentReagent" ("id", "documentId", "reagentId", "itemIndex", "createdAt")
        VALUES (${crypto.randomUUID()}, ${id}, ${reagent.id}, ${input.itemIndex}, CURRENT_TIMESTAMP)
      `;
    }

    recognition.items[input.itemIndex] = {
      ...item,
      ...reagentInput,
      reagentName: reagentInput.name,
      quantity: reagentInput.stockQuantity,
      confirmationStatus: 'CONFIRMED',
      reagentId: reagent.id,
      confirmedAt: new Date().toISOString(),
      pubchemStatus,
      ...(pubchemWarning ? { pubchemError: pubchemWarning } : {}),
    };
    await tx.document.update({
      where: { id },
      data: {
        recognitionResult: JSON.parse(JSON.stringify(recognition)),
        status: documentStatus(recognition.items),
        ...(input.itemIndex === 0 ? {
          reagentId: reagent.id,
          reagentLogId: reagentLog.id,
          reagentName: reagentInput.name,
          casNumber: reagentInput.casNumber || null,
          brand: reagentInput.brand || null,
          riskLevel: reagentInput.riskLevel,
          isHazardous: reagentInput.isHazardous,
          isControlled: reagentInput.isControlled,
        } : {}),
      },
    });
    return { reagentId: reagent.id, alreadyConfirmed: false };
  });

  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({
    data: { ...result, pubchemStatus, pubchemWarning },
    message: result.alreadyConfirmed
      ? '该条目已经入库'
      : pubchemWarning
        ? `该条目已确认入库；${pubchemWarning}`
        : pubchemStatus === 'ok'
          ? '该条目已确认入库，PubChem 信息已补全'
          : '该条目已确认入库；未填写 CAS 号，未调用 PubChem',
  });
});
