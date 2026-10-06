import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, parsePagination, paginatedResponse } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/assistant/sessions
 * 列出当前用户的会话历史
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const { page, pageSize } = parsePagination(searchParams);
  const assistantMode = searchParams.get('assistantMode');

  const where = {
    userId: authResult.userId, labId: authResult.labId,
    deletedAt: null, // 不返回已软删除的会话
    ...(assistantMode === 'RESEARCH' || assistantMode === 'MANAGEMENT' ? { assistantMode } : {}),
  };

  const [data, total] = await Promise.all([
    prisma.chatSession.findMany({
      where,
      orderBy: { lastActiveAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        role: true,
        assistantMode: true,
        lastActiveAt: true,
        createdAt: true,
        _count: { select: { messages: true } },
      },
    }),
    prisma.chatSession.count({ where }),
  ]);

  return NextResponse.json(paginatedResponse(data, total, page, pageSize));
});

/**
 * DELETE /api/assistant/sessions
 * 软删除会话（设置 deletedAt，30 天后由 cron 物理清理）
 *
 * 查询参数：?id=xxx 单个删除；?all=true 清空所有
 */
export const DELETE = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('id');
  const deleteAll = searchParams.get('all') === 'true';

  if (deleteAll) {
    const result = await prisma.chatSession.updateMany({
      where: { userId: authResult.userId, labId: authResult.labId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return NextResponse.json({ ok: true, deleted: result.count });
  }

  if (!sessionId) {
    return NextResponse.json({ error: '缺少会话 ID' }, { status: 400 });
  }

  // 校验归属权
  const session = await prisma.chatSession.findFirst({
    where: { id: sessionId, userId: authResult.userId, labId: authResult.labId },
    select: { id: true },
  });
  if (!session) {
    return NextResponse.json({ error: '会话不存在或无权访问' }, { status: 404 });
  }

  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
});
