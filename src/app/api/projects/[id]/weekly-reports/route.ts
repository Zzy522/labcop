import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { getProjectAccess } from '@/lib/research/projects';
import { weeklyReportSchema, validateWeeklyReportAttachments } from '@/lib/validations/project';
import { normalizeWeekStart } from '@/lib/research/schedule';
import { saveWeeklyReportAttachment, writeProjectBackupSnapshot } from '@/lib/project-storage';

type Context = { params: Promise<{ id: string }> };

export const POST = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  await getProjectAccess(id, ctx);

  const contentType = request.headers.get('content-type') || '';
  let raw: Record<string, unknown>;
  let files: File[] = [];
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    raw = {
      weekStart: form.get('weekStart'),
      title: form.get('title'),
      content: form.get('content'),
      blockers: form.get('blockers') || undefined,
      nextPlan: form.get('nextPlan') || undefined,
    };
    files = form.getAll('attachments').filter((item): item is File => item instanceof File && Boolean(item.name));
  } else {
    raw = await request.json();
  }

  const parsed = weeklyReportSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({
    error: parsed.error.issues.map((issue) => issue.message).join('；'),
    details: parsed.error.flatten().fieldErrors,
  }, { status: 400 });
  const attachmentError = validateWeeklyReportAttachments(files);
  if (attachmentError) return NextResponse.json({ error: attachmentError }, { status: 400 });

  const input = parsed.data;
  const reportId = crypto.randomUUID();
  const weekStart = normalizeWeekStart(input.weekStart)!;
  const storedFiles = await Promise.all(files.map((file) => saveWeeklyReportAttachment(id, reportId, file)));
  const snapshotPayload = {
    id: reportId,
    projectId: id,
    authorId: ctx.userId,
    weekStart: weekStart.toISOString(),
    title: input.title,
    content: input.content,
    blockers: input.blockers || null,
    nextPlan: input.nextPlan || null,
    attachments: storedFiles,
    backedUpAt: new Date().toISOString(),
  };
  const backup = await writeProjectBackupSnapshot(id, 'WEEKLY_REPORT', reportId, snapshotPayload);

  const report = await prisma.$transaction(async (tx) => {
    const created = await tx.projectWeeklyReport.create({
      data: {
        id: reportId,
        projectId: id,
        authorId: ctx.userId,
        weekStart,
        title: input.title,
        content: input.content,
        blockers: input.blockers || null,
        nextPlan: input.nextPlan || null,
        attachments: { create: storedFiles },
      },
      include: {
        author: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
      },
    });
    await tx.projectBackupSnapshot.create({ data: { projectId: id, entityType: 'WEEKLY_REPORT', entityId: reportId, fileUrl: backup.fileUrl, checksum: backup.checksum } });
    await tx.projectChangeLog.create({
      data: {
        projectId: id,
        entityType: 'WEEKLY_REPORT',
        entityId: created.id,
        action: 'SUBMIT',
        afterData: JSON.stringify({ weekStart: created.weekStart, title: created.title, attachments: storedFiles.map((file) => ({ fileName: file.fileName, sha256: file.sha256 })) }),
        operatorId: ctx.userId,
      },
    });
    return created;
  });

  return NextResponse.json({
    data: {
      ...report,
      weekStart: report.weekStart.toISOString(),
      createdAt: report.createdAt.toISOString(),
      attachments: report.attachments.map((file) => ({ ...file, createdAt: file.createdAt.toISOString() })),
    },
  }, { status: 201 });
});
