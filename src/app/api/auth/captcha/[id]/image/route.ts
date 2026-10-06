import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { getCaptchaSvg } from '@/lib/captcha';

export const GET = withErrorHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) => {
  const { id } = await context.params;
  const svg = await getCaptchaSvg(id);
  if (!svg) {
    return new NextResponse('验证码不存在或已过期', {
      status: 404,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Disposition': 'inline',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
