import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { prisma } from '@/lib/prisma';
import { sendCodeSchema } from '@/lib/validations/auth';
import { issueEmailCode } from '@/lib/auth';
import { sendVerificationCodeEmail } from '@/lib/email';
import { checkRateLimit, checkDailyLimit } from '@/lib/rate-limit';
import { verifyCaptcha } from '@/lib/captcha';
import { getClientIp } from '@/lib/auth-rate-limit';

/**
 * POST /api/auth/send-code
 *
 * 注册前发送邮箱验证码。防刷策略：
 * 1. 图形验证码（captchaId + captchaCode）— 拦截自动化脚本
 * 2. IP 突发限流：5 次/分钟（token bucket）
 * 3. IP 每日上限：100 次/天（自然日重置）
 * 4. 邮箱限流：60 秒 1 次
 *
 * 验证码本身无状态（HMAC），不入库（既不明文也不哈希存储），5 分钟有效。
 * 未配置 SMTP 时降级打印到服务器控制台（仅开发）。
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = sendCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: '输入校验失败', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { email, captchaId, captchaCode } = parsed.data;

  const ip = getClientIp(request);

  // 1) 图形验证码校验（先于其它限流，拦截机器人）
  if (!(await verifyCaptcha(captchaId, captchaCode))) {
    return NextResponse.json({ error: '图形验证码不正确或已过期，请刷新重试' }, { status: 400 });
  }

  // 2) IP 突发限流
  const ipBurst = checkRateLimit(`auth:send-code:ip:${ip}`, { capacity: 5, refillPerSec: 0.1 });
  if (!ipBurst.allowed) {
    return NextResponse.json(
      { error: `请求过于频繁，请 ${Math.ceil(ipBurst.retryAfterMs / 1000)} 秒后重试` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(ipBurst.retryAfterMs / 1000)) } }
    );
  }

  // 3) IP 每日上限 100 次
  const ipDaily = checkDailyLimit(`auth:send-code:ip-daily:${ip}`, 100);
  if (!ipDaily.allowed) {
    return NextResponse.json(
      { error: '当日发送次数已达上限，请明日再试' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(ipDaily.retryAfterMs / 1000)) } }
    );
  }

  // 4) 邮箱限流：60 秒 1 次
  const emailLimit = checkRateLimit(`auth:send-code:email:${email.toLowerCase()}`, {
    capacity: 1,
    refillPerSec: 1 / 60,
  });
  if (!emailLimit.allowed) {
    return NextResponse.json(
      { error: `验证码已发送，请 ${Math.ceil(emailLimit.retryAfterMs / 1000)} 秒后再试或检查邮箱（含垃圾箱）` },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(emailLimit.retryAfterMs / 1000)) } }
    );
  }

  // 已注册邮箱不发送（注册流程需要未注册邮箱）
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    return NextResponse.json({ error: '该邮箱已注册，请直接登录' }, { status: 409 });
  }

  const { token, code, expiresInSec } = issueEmailCode(email);
  await sendVerificationCodeEmail(email, code);

  return NextResponse.json({ token, expiresInSec, message: '验证码已发送，请查收邮箱（5 分钟内有效）' });
});
