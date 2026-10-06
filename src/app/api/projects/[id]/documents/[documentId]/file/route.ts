import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { getProjectAccess } from '@/lib/research/projects';
import { readProjectDocumentFile } from '@/lib/project-storage';

type Context = { params: Promise<{ id: string; documentId: string }> };

export const GET = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id, documentId: versionId } = await context.params;
  await getProjectAccess(id, ctx);

  const version = await prisma.projectDocumentVersion.findFirst({
    where: { id: versionId, document: { projectId: id, deletedAt: null } },
    select: { fileUrl: true, fileName: true, mimeType: true },
  });
  if (!version) return NextResponse.json({ error: '课题文档版本不存在' }, { status: 404 });

  const file = await readProjectDocumentFile(version.fileUrl);
  const encodedName = encodeURIComponent(version.fileName).replace(/'/g, '%27');
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': version.mimeType || 'application/octet-stream',
      'Content-Length': String(file.byteLength),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store',
    },
  });
});
