import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler, parsePagination, paginatedResponse } from '@/lib/api-utils';
import { getProjectAccess } from '@/lib/research/projects';

type Context = { params: Promise<{ id: string }> };

export const GET = withErrorHandler(async (request: NextRequest, context: Context) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const { id } = await context.params;
  await getProjectAccess(id, ctx);
  const { searchParams } = new URL(request.url);
  const { page, pageSize, skip } = parsePagination(searchParams, 30, 100);
  const entityType = searchParams.get('entityType') || undefined;
  const where = { projectId: id, ...(entityType ? { entityType } : {}) };
  const [total, logs] = await Promise.all([
    prisma.projectChangeLog.count({ where }),
    prisma.projectChangeLog.findMany({ where, include: { operator: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
  ]);
  return NextResponse.json(paginatedResponse(logs.map((log) => ({ ...log, beforeData: log.beforeData ? JSON.parse(log.beforeData) : null, afterData: log.afterData ? JSON.parse(log.afterData) : null, createdAt: log.createdAt.toISOString() })), total, page, pageSize));
});

