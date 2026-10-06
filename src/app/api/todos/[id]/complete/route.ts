import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { completeTodo } from '@/lib/services/todo.service';

/**
 * POST /api/todos/[id]/complete
 * 标记待办为已完成
 * - 接收人本人可完成
 * - 同实验室值日生可代为完成设备归位待办（多人场景任一人完成即关闭）
 */
export const POST = withErrorHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authResult = await requireAuth(_request);
  if (!isUserContext(authResult)) return authResult;

  const { id } = await params;
  try {
    const todo = await completeTodo(id, authResult.userId);
    return NextResponse.json({ data: todo, message: '待办已完成' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '操作失败';
    const status = msg.includes('不存在') ? 404 : msg.includes('无权') ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
});
