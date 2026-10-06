import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

/**
 * POST /api/error-report
 * 接收客户端错误上报（来自 src/lib/error-report.ts）
 *
 * 设计目标：
 * - 接收 navigator.sendBeacon 上报的错误负载
 * - 服务端用 console.error 输出结构化日志（生产可对接 ELK/Loki）
 * - 不持久化到数据库（避免错误风暴拖垮 DB）
 * - 限制单次请求体大小（防止恶意大 payload）
 *
 * 注意：本接口不做严格认证（sendBeacon 无法附加自定义 header），
 *      但通过 cookie session 隐式认证；且只记录用户角色等脱敏信息
 */

const MAX_PAYLOAD_SIZE = 10 * 1024; // 10KB

export async function POST(request: NextRequest) {
  try {
    // 隐式认证：检查 session（不强求，未登录也能上报崩溃前的错误）
    const authResult = await requireAuth(request);
    const isAuthenticated = isUserContext(authResult);

    // 读取请求体并限制大小
    const text = await request.text();
    if (text.length > MAX_PAYLOAD_SIZE) {
      return NextResponse.json({ ok: false, reason: 'payload_too_large' }, { status: 413 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, reason: 'invalid_json' }, { status: 400 });
    }

    // 服务端结构化日志输出（生产环境可对接日志收集器）
    // eslint-disable-next-line no-console
    console.error('[ClientErrorReport]', JSON.stringify({
      ...payload,
      serverTimestamp: new Date().toISOString(),
      authenticated: isAuthenticated,
      // 不记录真实 userId，仅记录是否已认证
    }));

    // 静默成功（不向前端返回错误，避免循环上报）
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    // 任何异常都不向前端报错（避免循环上报）
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
