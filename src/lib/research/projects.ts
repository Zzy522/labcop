import { prisma } from '@/lib/prisma';
import { Errors } from '@/lib/errors';
import type { UserContext } from '@/lib/auth-middleware';

export type ProjectAccessRole = 'ADMIN' | 'MANAGER' | 'MEMBER';

export async function getProjectAccess(projectId: string, ctx: UserContext) {
  if (!ctx.labId) throw Errors.forbidden('当前用户未关联实验室');
  const project = await prisma.researchProject.findFirst({
    where: { id: projectId, labId: ctx.labId, deletedAt: null },
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, role: true } } } },
    },
  });
  if (!project) throw Errors.notFound('课题');
  if (ctx.isAdmin) return { project, role: 'ADMIN' as ProjectAccessRole };
  const membership = project.members.find((member) => member.userId === ctx.userId);
  if (!membership) throw Errors.forbidden('您不是该课题成员');
  return { project, role: membership.role as ProjectAccessRole };
}

export function assertCanManage(role: ProjectAccessRole): void {
  if (role !== 'ADMIN' && role !== 'MANAGER') {
    throw Errors.forbidden('需要实验室管理员或课题管理员权限');
  }
}

export function canManage(role: ProjectAccessRole): boolean {
  return role === 'ADMIN' || role === 'MANAGER';
}

export async function writeProjectChange(input: {
  projectId: string;
  entityType: string;
  entityId: string;
  action: string;
  operatorId: string;
  beforeData?: unknown;
  afterData?: unknown;
  source?: 'DIRECT' | 'APPROVED_REQUEST';
  requestId?: string;
  reason?: string;
}): Promise<void> {
  await prisma.projectChangeLog.create({
    data: {
      projectId: input.projectId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      operatorId: input.operatorId,
      beforeData: input.beforeData === undefined ? null : JSON.stringify(input.beforeData),
      afterData: input.afterData === undefined ? null : JSON.stringify(input.afterData),
      source: input.source || 'DIRECT',
      requestId: input.requestId || null,
      reason: input.reason || null,
    },
  });
}

export function projectProgress(tasks: Array<{ status: string; progress: number }>): number {
  if (tasks.length === 0) return 0;
  return Math.round(tasks.reduce((sum, task) => sum + (task.status === 'COMPLETED' ? 100 : task.progress), 0) / tasks.length);
}

export function publicTask(task: {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  status: string;
  priority: string;
  progress: number;
  estimatedWeeks: number;
  tags: string;
  blockedReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  assignees: Array<{ isLead: boolean; user: { id: string; name: string; email?: string } }>;
  updates?: Array<{
    id: string;
    note: string;
    progress: number;
    status: string;
    tags: string;
    createdAt: Date;
    author: { id: string; name: string };
  }>;
}) {
  return {
    ...task,
    estimatedWeeks: inferEstimatedWeeks(task.startDate, task.dueDate, task.estimatedWeeks),
    tags: parseStringArray(task.tags),
    startDate: task.startDate?.toISOString() ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    assignees: task.assignees.map((item) => ({ ...item.user, isLead: item.isLead })),
    updates: task.updates?.map((item) => ({ ...item, tags: parseStringArray(item.tags), createdAt: item.createdAt.toISOString() })) ?? [],
  };
}

function inferEstimatedWeeks(startDate: Date | null, dueDate: Date | null, storedWeeks: number): number {
  if (!startDate || !dueDate) return Math.max(1, storedWeeks);
  const inferred = Math.ceil((dueDate.getTime() - startDate.getTime() + 24 * 60 * 60 * 1000) / (7 * 24 * 60 * 60 * 1000));
  return Math.max(1, storedWeeks, inferred);
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}
