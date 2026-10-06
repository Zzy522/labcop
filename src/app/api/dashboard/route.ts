import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { withErrorHandler } from '@/lib/api-utils';

// 兼容旧客户端，同时避免旧版全局统计跨实验室泄漏数据。
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  const destination = request.nextUrl.clone();
  destination.pathname = ctx.isAdmin ? '/api/dashboard/admin' : '/api/dashboard/member';
  destination.search = '';
  return NextResponse.redirect(destination, 307);
});
