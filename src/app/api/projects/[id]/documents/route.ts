import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { getProjectAccess } from '@/lib/research/projects';
import { saveProjectDocumentFile } from '@/lib/project-storage';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'text/csv',
]);

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  await getProjectAccess(id, ctx);
  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '请选择课题文档' }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: '文件不能超过 50MB' }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) return NextResponse.json({ error: `不支持的文件类型：${file.type || '未知'}` }, { status: 400 });
  const documentId = String(formData.get('documentId') || '');
  const title = String(formData.get('title') || file.name).trim();
  const docType = String(formData.get('docType') || 'OTHER').trim().slice(0, 40);
  const description = String(formData.get('description') || '').trim().slice(0, 2000);
  const changeNote = String(formData.get('changeNote') || '').trim().slice(0, 1000);

  const storedPath = await saveProjectDocumentFile(id, file);
  const result = await prisma.$transaction(async (tx) => {
    let document = documentId
      ? await tx.projectDocument.findFirst({ where: { id: documentId, projectId: id, deletedAt: null } })
      : null;
    if (documentId && !document) throw new Error('课题文档不存在');
    if (!document) {
      document = await tx.projectDocument.create({ data: { projectId: id, title, docType, description: description || null, createdById: ctx.userId } });
    }
    const latest = await tx.projectDocumentVersion.findFirst({ where: { documentId: document.id }, orderBy: { version: 'desc' }, select: { version: true } });
    const version = await tx.projectDocumentVersion.create({
      data: {
        documentId: document.id,
        version: (latest?.version || 0) + 1,
        fileUrl: storedPath,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        changeNote: changeNote || null,
        status: 'PENDING_REVIEW',
        uploadedById: ctx.userId,
        submittedAt: new Date(),
      },
    });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'DOCUMENT_VERSION', entityId: version.id, action: 'SUBMIT', afterData: JSON.stringify(version), operatorId: ctx.userId, reason: changeNote || null } });
    return { document, version };
  });
  return NextResponse.json({ data: result }, { status: 201 });
});

