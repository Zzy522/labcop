import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/assistant/sessions/[id]
 * 拉取指定会话的消息历史（用于前端刷新页面后恢复对话）
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });

  const { id } = await params;

  // 校验会话归属权
  const session = await prisma.chatSession.findFirst({
    where: { id, userId: authResult.userId, labId: authResult.labId, deletedAt: null },
    select: { id: true, title: true, role: true, assistantMode: true, lastActiveAt: true, summary: true },
  });
  if (!session) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }

  // Bound abandoned tasks after a server restart; never replay tool calls automatically.
  await prisma.assistantRun.updateMany({ where: { message: { sessionId: id }, status: { in: ['RUNNING', 'CANCEL_REQUESTED'] }, createdAt: { lt: new Date(Date.now() - 600000) } }, data: { status: 'ERROR', error: 'GENERATION_EXPIRED', finishedAt: new Date() } });
  // 拉取最近 50 条消息（按时间正序，便于直接渲染）
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 50,
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      feedback: true,
      run: { select: { id: true, status: true } },
    },
  });

  return NextResponse.json({
    session,
    messages: messages.reverse(),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
});
