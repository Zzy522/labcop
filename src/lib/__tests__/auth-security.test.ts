import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueEmailCode, signJwt, verifyEmailCode, verifyJwt } from '@/lib/auth';
import { emailSchema, sendCodeSchema } from '@/lib/validations/auth';

function signedToken(payload: object, header: object = { alg: 'HS256', typ: 'JWT' }) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac('sha256', process.env.JWT_SECRET!).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

describe('认证输入规范化与令牌校验', () => {
  beforeEach(() => {
    vi.stubEnv('JWT_SECRET', 'test-only-secret-with-sufficient-entropy');
  });

  it('发送验证码与账号邮件输入统一转为小写', () => {
    expect(sendCodeSchema.parse({ email: ' User.Name@Example.COM ', captchaId: 'id', captchaCode: 'ABCD' }).email)
      .toBe('user.name@example.com');
    expect(emailSchema.parse({ email: ' User.Name@Example.COM ' }).email)
      .toBe('user.name@example.com');
  });

  it('邮箱验证码签发与验证对大小写和首尾空格一致规范化', () => {
    const issued = issueEmailCode(' User.Name@Example.COM ');
    expect(verifyEmailCode(issued.token, 'user.name@example.com', issued.code)).toBe(true);
  });

  it('拒绝未来签发、时间倒置和算法头异常的 JWT', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(verifyJwt(signedToken({ sub: 'u1', role: 'MEMBER', iat: now + 120, exp: now + 3600 }))).toBeNull();
    expect(verifyJwt(signedToken({ sub: 'u1', role: 'MEMBER', iat: now, exp: now }))).toBeNull();
    expect(verifyJwt(signedToken({ sub: 'u1', role: 'MEMBER', iat: now, exp: now + 3600 }, { alg: 'none', typ: 'JWT' }))).toBeNull();
  });

  it('接受由服务端正常签发的 JWT', () => {
    const token = signJwt({ sub: 'u1', role: 'MEMBER' }, '5m');
    expect(verifyJwt(token)?.sub).toBe('u1');
  });
});
