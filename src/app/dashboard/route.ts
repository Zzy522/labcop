import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 旧路由 /dashboard 重定向到 /admin
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  // 将 /dashboard/xxx 重定向到 /admin/xxx
  url.pathname = url.pathname.replace(/^\/dashboard/, '/admin');
  return NextResponse.redirect(url);
}
