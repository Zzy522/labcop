import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';
import { projectProgress } from '@/lib/research/projects';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAdmin(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [projects, compoundCount, synthesisBatchCount, bioAssayCount, recentCompoundCount] = await Promise.all([
    prisma.researchProject.findMany({
      where: { labId: ctx.labId, deletedAt: null },
      include: {
        members: { where: { role: 'MANAGER' }, include: { user: { select: { id: true, name: true } } } },
        tasks: { where: { deletedAt: null }, select: { id: true, name: true, status: true, progress: true, dueDate: true, updatedAt: true } },
        documents: { where: { deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1, select: { status: true, createdAt: true } } } },
        compounds: { select: { createdAt: true, compound: { select: { updatedAt: true } } } },
        changeRequests: { where: { status: 'PENDING' }, select: { id: true } },
      },
    }),
    prisma.compound.count({ where: { labId: ctx.labId } }),
    prisma.synthesisBatch.count({ where: { labId: ctx.labId } }),
    prisma.bioAssay.count({ where: { labId: ctx.labId } }),
    prisma.compound.count({ where: { labId: ctx.labId, updatedAt: { gte: thirtyDaysAgo } } }),
  ]);

  const projectCards = projects.map((project) => {
    const latest = Math.max(
      project.updatedAt.getTime(),
      ...project.tasks.map((task) => task.updatedAt.getTime()),
      ...project.documents.flatMap((document) => document.versions.map((version) => version.createdAt.getTime())),
      ...project.compounds.flatMap((link) => [link.createdAt.getTime(), link.compound.updatedAt.getTime()]),
    );
    const overdue = project.tasks.filter((task) => task.dueDate && task.dueDate < now && !['COMPLETED', 'CANCELLED'].includes(task.status));
    const pendingDocuments = project.documents.filter((document) => document.versions[0]?.status === 'PENDING_REVIEW').length;
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      progress: projectProgress(project.tasks),
      managers: project.members.map((member) => member.user),
      taskCount: project.tasks.length,
      activeTaskCount: project.tasks.filter((task) => ['PLANNED', 'IN_PROGRESS', 'BLOCKED'].includes(task.status)).length,
      overdueTaskCount: overdue.length,
      pendingDocumentCount: pendingDocuments,
      pendingChangeCount: project.changeRequests.length,
      compoundCount: project.compounds.length,
      recentUpdatedAt: new Date(latest).toISOString(),
      recentUpdateLabel: overdue.length > 0
        ? `${overdue.length} 项阶段任务逾期`
        : pendingDocuments > 0
          ? `${pendingDocuments} 份文档待审核`
          : project.tasks.find((task) => task.status === 'IN_PROGRESS')?.name || '课题资料近期有更新',
    };
  }).sort((a, b) => new Date(b.recentUpdatedAt).getTime() - new Date(a.recentUpdatedAt).getTime());

  return NextResponse.json({
    projectTotal: projects.length,
    activeProjectCount: projects.filter((project) => project.status === 'ACTIVE').length,
    compoundCount,
    synthesisBatchCount,
    bioAssayCount,
    recentCompoundCount,
    activeTaskCount: projectCards.reduce((sum, project) => sum + project.activeTaskCount, 0),
    overdueTaskCount: projectCards.reduce((sum, project) => sum + project.overdueTaskCount, 0),
    pendingDocumentCount: projectCards.reduce((sum, project) => sum + project.pendingDocumentCount, 0),
    pendingChangeCount: projectCards.reduce((sum, project) => sum + project.pendingChangeCount, 0),
    recentUpdatedProjects: projectCards.slice(0, 8),
  });
});

