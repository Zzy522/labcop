import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { getProjectAccess } from '@/lib/research/projects';
import { readProjectDocumentFile } from '@/lib/project-storage';

type Context = { params: Promise<{ id: string; reportId: string; attachmentId: string }> };

export const GET = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id, reportId, attachmentId } = await context.params;
  await getProjectAccess(id, ctx);

  const attachment = await prisma.projectWeeklyReportAttachment.findFirst({
    where: { id: attachmentId, reportId, report: { projectId: id } },
  });
  if (!attachment) return NextResponse.json({ error: '周报附件不存在' }, { status: 404 });

  const file = await readProjectDocumentFile(attachment.fileUrl);
  const encodedName = encodeURIComponent(attachment.fileName).replace(/'/g, '%27');
  return new NextResponse(new Uint8Array(file), {
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Length': String(file.byteLength),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store',
      'X-Content-SHA256': attachment.sha256,
    },
  });
});
