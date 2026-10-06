import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { getProjectAccess, assertCanManage, canManage, projectProgress, publicTask } from '@/lib/research/projects';
import { projectUpdateSchema, parseOptionalDate } from '@/lib/validations/project';

type Context = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  const access = await getProjectAccess(id, ctx);

  const project = await prisma.researchProject.findUniqueOrThrow({
    where: { id },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } }, orderBy: { createdAt: 'asc' } },
      tasks: {
        where: { deletedAt: null },
        include: {
          assignees: { include: { user: { select: { id: true, name: true, email: true } } } },
          updates: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 },
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
      },
      documents: {
        where: { deletedAt: null },
        include: {
          versions: {
            orderBy: { version: 'desc' },
            include: {
              uploadedBy: { select: { id: true, name: true } },
              reviews: { include: { reviewer: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
      },
      compounds: {
        include: { compound: { select: { id: true, name: true, commonName: true, casNumber: true, status: true, updatedAt: true, _count: { select: { synthesisBatches: true, bioAssays: true, documents: true } } } } },
        orderBy: { createdAt: 'desc' },
      },
      changeRequests: {
        orderBy: { createdAt: 'desc' },
        include: {
          task: { select: { id: true, name: true, version: true } },
          requester: { select: { id: true, name: true } },
          reviewer: { select: { id: true, name: true } },
        },
      },
      weeklyReports: {
        include: {
          author: { select: { id: true, name: true } },
          attachments: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ weekStart: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      },
      aiSummaries: {
        include: { requestedBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  return NextResponse.json({
    data: {
      id: project.id,
      name: project.name,
      description: project.description,
      objective: project.objective,
      status: project.status,
      startDate: project.startDate?.toISOString() ?? null,
      endDate: project.endDate?.toISOString() ?? null,
      version: project.version,
      progress: projectProgress(project.tasks),
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      accessRole: access.role,
      canManage: canManage(access.role),
      members: project.members.map((member) => ({ ...member.user, projectRole: member.role, joinedAt: member.createdAt.toISOString() })),
      tasks: project.tasks.map(publicTask),
      documents: project.documents.map((document) => ({
        ...document,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
        versions: document.versions.map((version) => ({
          ...version,
          submittedAt: version.submittedAt?.toISOString() ?? null,
          createdAt: version.createdAt.toISOString(),
          reviews: version.reviews.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })),
        })),
      })),
      compounds: project.compounds.map((link) => ({ role: link.role, addedAt: link.createdAt.toISOString(), ...link.compound })),
      changeRequests: project.changeRequests.map((item) => ({ ...item, patchData: JSON.parse(item.patchData), reviewedAt: item.reviewedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
      weeklyReports: project.weeklyReports.map((report) => ({
        ...report,
        weekStart: report.weekStart.toISOString(),
        createdAt: report.createdAt.toISOString(),
        attachments: report.attachments.map((file) => ({
          id: file.id,
          reportId: file.reportId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          fileSize: file.fileSize,
          sha256: file.sha256,
          backupReady: Boolean(file.backupUrl),
          createdAt: file.createdAt.toISOString(),
        })),
      })),
      aiSummaries: project.aiSummaries.map((summary) => ({ ...summary, createdAt: summary.createdAt.toISOString() })),
    },
  });
});

export const PATCH = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  const access = await getProjectAccess(id, ctx);
  assertCanManage(access.role);

  const parsed = projectUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const input = parsed.data;
  if (input.status === 'ARCHIVED' && !ctx.isAdmin) {
    return NextResponse.json({ error: '只有实验室管理员可以归档课题' }, { status: 403 });
  }
  if (input.status === 'ACTIVE') {
    const managers = access.project.members.filter((member) => member.role === 'MANAGER').length;
    if (managers < 1 || managers > 3) return NextResponse.json({ error: '进行中的课题必须指定 1～3 名实验员课题管理员' }, { status: 400 });
  }
  if (input.version !== access.project.version) return NextResponse.json({ error: '课题已被其他人修改，请刷新后重试', category: 'BUSINESS_CONFLICT' }, { status: 409 });

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.researchProject.update({
      where: { id, version: input.version },
      data: {
        name: input.name,
        description: input.description,
        objective: input.objective,
        status: input.status,
        startDate: parseOptionalDate(input.startDate),
        endDate: parseOptionalDate(input.endDate),
        version: { increment: 1 },
      },
    });
    await tx.projectChangeLog.create({
      data: {
        projectId: id,
        entityType: 'PROJECT',
        entityId: id,
        action: 'UPDATE',
        beforeData: JSON.stringify(access.project),
        afterData: JSON.stringify(result),
        operatorId: ctx.userId,
      },
    });
    return result;
  });
  return NextResponse.json({ data: updated });
});

export const DELETE = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  const access = await getProjectAccess(id, ctx);
  if (!ctx.isAdmin) return NextResponse.json({ error: '只有实验室管理员可以归档课题' }, { status: 403 });
  const archived = await prisma.$transaction(async (tx) => {
    const result = await tx.researchProject.update({ where: { id }, data: { status: 'ARCHIVED', deletedAt: new Date(), version: { increment: 1 } } });
    await tx.projectChangeLog.create({ data: { projectId: id, entityType: 'PROJECT', entityId: id, action: 'ARCHIVE', beforeData: JSON.stringify(access.project), afterData: JSON.stringify(result), operatorId: ctx.userId } });
    return result;
  });
  return NextResponse.json({ data: archived });
});
