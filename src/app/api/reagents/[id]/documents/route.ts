import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { requireAuth } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import path from 'path';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'private', 'reagents');

/** 生成安全的文件名：去除路径分隔符，附加时间戳防冲突 */
function safeFileName(original: string): string {
  const base = path.basename(original).replace(/[^\w.\-\u4e00-\u9fa5]/g, '_');
  const ts = Date.now();
  return `${ts}_${base}`;
}

/**
 * 校验试剂是否属于当前用户的实验室
 */
async function checkReagentOwnership(reagentId: string, labId?: string): Promise<boolean> {
  if (!labId) return false;
  const reagent = await prisma.reagent.findUnique({
    where: { id: reagentId },
    select: { labId: true },
  });
  return !!reagent && reagent.labId === labId;
}

/**
 * POST /api/reagents/[id]/documents
 * 上传 MSDS / SOP 文件（仅管理员）
 * FormData: file + docType('MSDS' | 'SOP')
 */
export const POST = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;

  // IDOR 修复：校验试剂归属
  const owned = await checkReagentOwnership(id, authResult.labId);
  if (!owned) {
    return NextResponse.json({ error: '试剂不存在或无权访问' }, { status: 404 });
  }

  const reagent = await prisma.reagent.findUnique({ where: { id }, select: { name: true } });
  if (!reagent) {
    return NextResponse.json({ error: '试剂不存在' }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const docType = (formData.get('docType') as string) || '';

  if (!file) {
    return NextResponse.json({ error: '请选择要上传的文件' }, { status: 400 });
  }
  if (docType !== 'MSDS' && docType !== 'SOP') {
    return NextResponse.json({ error: '文档类型必须为 MSDS 或 SOP' }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: '文件大小不能超过 10MB' }, { status: 400 });
  }
  const allowedTypes = new Set(['application/pdf', 'image/png', 'image/jpeg']);
  const extension = path.extname(file.name).toLowerCase();
  if (!allowedTypes.has(file.type) || !['.pdf', '.png', '.jpg', '.jpeg'].includes(extension)) return NextResponse.json({ error: '仅允许 PDF、PNG 或 JPEG 文档' }, { status: 400 });

  // 确保上传目录存在
  await mkdir(UPLOAD_DIR, { recursive: true });

  const fileName = safeFileName(file.name);
  const filePath = path.join(UPLOAD_DIR, fileName);
  const fileUrl = `private:reagents/${fileName}`;

  // 写入文件
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const signatureOk = file.type === 'application/pdf' ? buffer.subarray(0, 5).toString() === '%PDF-' : file.type === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (!signatureOk) return NextResponse.json({ error: '文件内容与声明类型不一致' }, { status: 400 });
  await writeFile(filePath, buffer, { flag: 'wx' });

  // 更新试剂字段
  const updateData =
    docType === 'MSDS'
      ? { msdsUrl: fileUrl, msdsFileName: file.name }
      : { sopUrl: fileUrl, sopFileName: file.name };

  await prisma.reagent.update({ where: { id }, data: updateData });

  await logAudit({
    operatorId: authResult.userId,
    action: 'UPDATE',
    targetType: 'REAGENT',
    targetId: id,
    targetName: reagent.name,
    labId: authResult.labId,
    afterData: updateData,
    note: `上传${docType} 文件「${file.name}」到试剂「${reagent.name}」`,
  });

  return NextResponse.json({
    data: updateData,
    message: `${docType} 文件上传成功`,
  });
});

/**
 * DELETE /api/reagents/[id]/documents?docType=MSDS
 * 删除 MSDS / SOP 文件（仅管理员）
 */
export const DELETE = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;

  // IDOR 修复：校验试剂归属
  const owned = await checkReagentOwnership(id, authResult.labId);
  if (!owned) {
    return NextResponse.json({ error: '试剂不存在或无权访问' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const docType = searchParams.get('docType') || '';

  if (docType !== 'MSDS' && docType !== 'SOP') {
    return NextResponse.json({ error: '文档类型必须为 MSDS 或 SOP' }, { status: 400 });
  }

  const reagent = await prisma.reagent.findUnique({
    where: { id },
    select: { name: true, msdsUrl: true, msdsFileName: true, sopUrl: true, sopFileName: true },
  });
  if (!reagent) {
    return NextResponse.json({ error: '试剂不存在' }, { status: 404 });
  }

  const fileUrl = docType === 'MSDS' ? reagent.msdsUrl : reagent.sopUrl;
  const fileName = docType === 'MSDS' ? reagent.msdsFileName : reagent.sopFileName;

  if (!fileUrl) {
    return NextResponse.json({ error: `该试剂尚未上传 ${docType} 文件` }, { status: 400 });
  }

  // 删除物理文件（失败不阻塞主流程）
  try {
    const physicalPath = fileUrl.startsWith('private:reagents/') ? path.join(UPLOAD_DIR, path.basename(fileUrl)) : path.join(process.cwd(), 'public', fileUrl);
    await unlink(physicalPath);
  } catch {
    // 文件可能已被手动删除，忽略错误
  }

  // 清空试剂字段
  const updateData =
    docType === 'MSDS'
      ? { msdsUrl: null, msdsFileName: null }
      : { sopUrl: null, sopFileName: null };

  await prisma.reagent.update({ where: { id }, data: updateData });

  await logAudit({
    operatorId: authResult.userId,
    action: 'UPDATE',
    targetType: 'REAGENT',
    targetId: id,
    targetName: reagent.name,
    labId: authResult.labId,
    afterData: updateData,
    note: `删除${docType} 文件「${fileName || ''}」`,
  });

  return NextResponse.json({ message: `${docType} 文件已删除` });
});

/** GET 受保护下载：浏览器不再直接访问 public/uploads。 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  const { id } = await params;
  if (!(await checkReagentOwnership(id, authResult.labId))) return NextResponse.json({ error: '试剂不存在或无权访问' }, { status: 404 });
  const docType = request.nextUrl.searchParams.get('docType');
  if (docType !== 'MSDS' && docType !== 'SOP') return NextResponse.json({ error: '文档类型无效' }, { status: 400 });
  const reagent = await prisma.reagent.findUnique({ where: { id }, select: { msdsUrl: true, msdsFileName: true, sopUrl: true, sopFileName: true } });
  const stored = docType === 'MSDS' ? reagent?.msdsUrl : reagent?.sopUrl;
  const original = docType === 'MSDS' ? reagent?.msdsFileName : reagent?.sopFileName;
  if (!stored) return NextResponse.json({ error: '文档不存在' }, { status: 404 });
  const physicalPath = stored.startsWith('private:reagents/') ? path.join(UPLOAD_DIR, path.basename(stored)) : path.join(process.cwd(), 'public', stored);
  const content = await readFile(physicalPath).catch(() => null);
  if (!content) return NextResponse.json({ error: '文档文件缺失' }, { status: 404 });
  const ext = path.extname(original || '').toLowerCase();
  const type = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : 'image/jpeg';
  return new NextResponse(content, { headers: { 'Content-Type': type, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(original || `${docType}${ext}`)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
});
