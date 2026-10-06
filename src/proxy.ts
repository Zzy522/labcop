import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AUTH_COOKIE } from '@/lib/auth';
import { getMaintenanceSnapshot } from '@/lib/maintenance';

/**
 * 认证代理（Next.js middleware，运行于 Edge runtime）。
 *
 * 策略：
 * - middleware 仅做粗粒度 Cookie 存在性检查（Edge 无法做重计算/验签）
 * - 完整 JWT 签名校验在 route handler（Node runtime）的 getUserContext 中完成
 * - 页面导航由客户端 auth store 控制
 *
 * 已废弃 x-user-id / x-user-role 请求头方案。
 */
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith('/api/');
  const maintenanceBypass =
    pathname === '/maintenance' ||
    pathname === '/developer-login' ||
    pathname === '/platform' ||
    pathname.startsWith('/platform/') ||
    pathname === '/api/platform' ||
    pathname.startsWith('/api/platform/') ||
    pathname === '/api/system/maintenance' ||
    pathname === '/api/auth/developer-login' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/session' ||
    pathname === '/api/health' ||
    pathname === '/api/error-report';

  if (!maintenanceBypass) {
    const maintenance = await getMaintenanceSnapshot();
    if (maintenance.active) {
      if (isApi) {
        return NextResponse.json(
          { error: maintenance.message, category: 'MAINTENANCE', maintenance },
          { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } },
        );
      }
      return NextResponse.redirect(new URL('/maintenance', request.url), 307);
    }
  }

  // 页面只参与维护模式判断；现有登录页面守卫保持不变。
  if (!isApi) return NextResponse.next();

  // 认证相关路由放行（login/register/logout 等无需登录）
  // 健康检查放行（供 Nginx / 监控探活）
  // 实验室搜索放行（注册流程中未登录时需查找实验室）
  const publicAuthRoute =
    pathname === '/api/auth/captcha' ||
    pathname.startsWith('/api/auth/captcha/') ||
    pathname === '/api/auth/developer-login' ||
    pathname === '/api/auth/forgot-password' ||
    pathname === '/api/auth/login' ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/register' ||
    pathname === '/api/auth/resend-verification' ||
    pathname === '/api/auth/reset-password' ||
    pathname === '/api/auth/send-code' ||
    pathname === '/api/auth/verify-email';
  if (
    publicAuthRoute ||
    pathname === '/api/system/maintenance' ||
    pathname === '/api/health' ||
    pathname === '/api/labs/search' ||
    pathname === '/api/error-report'
  ) {
    return NextResponse.next();
  }

  // 检查认证 Cookie 是否存在（签名校验交给 route handler）
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: '未登录，请先登录', category: 'AUTH_INVALID' }, { status: 401 });
  }

  return NextResponse.next();
}

// 排除静态资源，其他路径都经过 proxy
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|public/).*)'],
};
