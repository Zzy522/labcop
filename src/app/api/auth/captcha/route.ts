import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { generateCaptcha } from '@/lib/captcha';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/auth-rate-limit';

/**
 * GET /api/auth/captcha
 *
 * 返回 { id, imageUrl, expiresInSec }，图片通过同源 SVG 路由加载。
 * 限流：每 IP 30 次/分钟。
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`auth:captcha:ip:${ip}`, { capacity: 30, refillPerSec: 0.5 });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: '请求过于频繁，请稍后再试' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(limit.retryAfterMs / 1000)) } }
    );
  }
  const challenge = await generateCaptcha();
  return NextResponse.json(challenge, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
});
