import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { projectCreateSchema, parseOptionalDate } from '@/lib/validations/project';
import { projectProgress } from '@/lib/research/projects';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) return NextResponse.json({ data: [] });

  const projects = await prisma.researchProject.findMany({
    where: {
      labId: ctx.labId,
      deletedAt: null,
      ...(ctx.isAdmin ? {} : { members: { some: { userId: ctx.userId } } }),
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'asc' },
      },
      tasks: { where: { deletedAt: null }, select: { status: true, progress: true, dueDate: true, updatedAt: true } },
      documents: {
        where: { deletedAt: null },
        include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { status: true, createdAt: true } } },
      },
      compounds: { select: { compoundId: true, createdAt: true } },
      changeRequests: { where: { status: 'PENDING' }, select: { id: true } },
    },
  });

  return NextResponse.json({
    data: projects.map((project) => {
      const membership = project.members.find((member) => member.userId === ctx.userId);
      const updatedCandidates = [
        project.updatedAt,
        ...project.tasks.map((task) => task.updatedAt),
        ...project.documents.flatMap((document) => document.versions.map((version) => version.createdAt)),
        ...project.compounds.map((link) => link.createdAt),
      ];
      return {
        id: project.id,
        name: project.name,
        description: project.description,
        objective: project.objective,
        status: project.status,
        startDate: project.startDate?.toISOString() ?? null,
        endDate: project.endDate?.toISOString() ?? null,
        version: project.version,
        progress: projectProgress(project.tasks),
        managers: project.members.filter((member) => member.role === 'MANAGER').map((member) => member.user),
        memberCount: project.members.length,
        taskCount: project.tasks.length,
        overdueTaskCount: project.tasks.filter((task) => task.dueDate && task.dueDate < new Date() && task.status !== 'COMPLETED' && task.status !== 'CANCELLED').length,
        pendingDocumentCount: project.documents.filter((document) => document.versions[0]?.status === 'PENDING_REVIEW').length,
        pendingChangeCount: project.changeRequests.length,
        compoundCount: project.compounds.length,
        accessRole: ctx.isAdmin ? 'ADMIN' : membership?.role || 'MEMBER',
        recentUpdatedAt: new Date(Math.max(...updatedCandidates.map((date) => date.getTime()))).toISOString(),
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
    }),
  });
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAdmin(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });

  const parsed = projectCreateSchema.safeParse(await request.json());
  if (!parsed.success) return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const input = parsed.data;
  const managerIds = [...new Set(input.managerIds)];
  const memberIds = [...new Set(input.memberIds)].filter((id) => !managerIds.includes(id));
  if (managerIds.length < 1 || managerIds.length > 3) {
    return NextResponse.json({ error: '每个课题必须指定 1～3 名实验员课题管理员' }, { status: 400 });
  }

  const selectedUsers = await prisma.user.findMany({
    where: { id: { in: [...managerIds, ...memberIds] }, labId: ctx.labId },
    select: { id: true, role: true },
  });
  if (selectedUsers.length !== managerIds.length + memberIds.length || managerIds.some((id) => selectedUsers.find((user) => user.id === id)?.role !== 'MEMBER')) {
    return NextResponse.json({ error: '课题成员必须是当前实验室用户，课题管理员必须是实验员' }, { status: 400 });
  }

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.researchProject.create({
      data: {
        labId: ctx.labId!,
        name: input.name,
        description: input.description || null,
        objective: input.objective || null,
        status: input.status,
        startDate: parseOptionalDate(input.startDate),
        endDate: parseOptionalDate(input.endDate),
        createdById: ctx.userId,
      },
    });
    if (managerIds.length + memberIds.length > 0) {
      await tx.projectMember.createMany({
        data: [
          ...managerIds.map((userId) => ({ projectId: created.id, userId, role: 'MANAGER', addedById: ctx.userId })),
          ...memberIds.map((userId) => ({ projectId: created.id, userId, role: 'MEMBER', addedById: ctx.userId })),
        ],
      });
    }
    await tx.projectChangeLog.create({
      data: {
        projectId: created.id,
        entityType: 'PROJECT',
        entityId: created.id,
        action: 'CREATE',
        afterData: JSON.stringify({ ...created, managerIds, memberIds }),
        operatorId: ctx.userId,
      },
    });
    return created;
  });

  return NextResponse.json({ data: project }, { status: 201 });
});
