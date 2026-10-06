import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 旧路由 /dashboard/xxx 子路由重定向到 /admin/xxx
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = url.pathname.replace(/^\/dashboard/, '/admin');
  return NextResponse.redirect(url);
}
