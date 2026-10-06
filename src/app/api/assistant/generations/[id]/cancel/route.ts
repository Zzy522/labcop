import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { withErrorHandler } from '@/lib/api-utils';

export const POST = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  if (!auth.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  const { id } = await params;
  const run = await prisma.assistantRun.findFirst({ where: { id, userId: auth.userId, labId: auth.labId, message: { session: { deletedAt: null } } }, select: { id: true } });
  if (!run) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  await prisma.assistantRun.updateMany({ where: { id, status: 'RUNNING' }, data: { status: 'CANCEL_REQUESTED' } });
  return NextResponse.json({ ok: true });
});
