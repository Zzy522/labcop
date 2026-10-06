/**
 * 认证核心模块 — JWT(HS256) + scrypt 密码哈希 + HttpOnly Cookie
 *
 * 替代旧的 x-user-id / x-user-role 请求头方案（可伪造）。
 * - JWT 签名/验证使用 Node 内置 crypto（HMAC-SHA256），无外部依赖
 * - 密码哈希使用 scrypt（Node 内置，抗暴力破解，推荐替代 bcrypt）
 * - Cookie 设为 HttpOnly + SameSite=Lax + Secure(生产)，防 XSS 窃取与 CSRF
 *
 * 令牌载荷：{ sub: userId, role, labId, iat, exp }
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

export const AUTH_COOKIE = 'ls_auth';

const SCRYPT_KEYLEN = 32;
const SCRYPT_N = 16384; // CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// ─── 密钥 ───
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('生产环境必须配置 JWT_SECRET 环境变量');
    }
    // 开发态回退（不安全，仅本地）
    return 'dev-insecure-jwt-secret-do-not-use-in-prod';
  }
  return secret;
}

// ─── base64url ───
function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

// ─── JWT ───
export interface JwtPayload {
  sub: string; // userId
  role: 'ADMIN' | 'MEMBER';
  labId?: string;
  iat: number;
  exp: number;
}

function sign(data: string): string {
  return createHmac('sha256', getJwtSecret()).update(data).digest('base64url');
}

/** 签发 JWT */
export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, expiresIn = '7d'): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + parseExpiresIn(expiresIn);
  const fullPayload: JwtPayload = { ...payload, iat: now, exp };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(fullPayload));
  const sig = sign(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

/** 验证 JWT，失败返回 null */
export function verifyJwt(token: string): JwtPayload | null {
  const raw = verifySignedPayload(token);
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Partial<JwtPayload>;
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof payload.sub !== 'string' || !payload.sub ||
    (payload.role !== 'ADMIN' && payload.role !== 'MEMBER') ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.iat! > now + 60 ||
    payload.exp! <= now ||
    payload.exp! <= payload.iat!
  ) return null;
  return payload as JwtPayload;
}

function verifySignedPayload(token: string): unknown | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  try {
    const parsedHeader = JSON.parse(b64urlDecode(header).toString('utf8')) as { alg?: unknown; typ?: unknown };
    if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') return null;
  } catch {
    return null;
  }
  // 验签（常量时间比较）
  const expected = sign(`${header}.${body}`);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    return JSON.parse(b64urlDecode(body).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function parseExpiresIn(input: string): number {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) return 7 * 24 * 3600; // 默认 7 天
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * multipliers[unit];
}

// ─── 邮箱验证码（注册时使用，无状态 HMAC 方案）───
//
// 设计要点：
// - 6 位数字验证码 = HMAC(JWT_SECRET, "email-code:" + email + ":" + nonce + ":" + exp) 取模 10^6
// - 颁发的令牌（返回前端）只含 { purpose, email, nonce, exp }（签名），**不含验证码本身**
//   → 前端/中间人无法从令牌反推出验证码（需服务器密钥），杜绝离线爆破
// - 验证码通过邮件下发；校验时服务器用同一密钥重算并常量时间比较
// - 令牌 5 分钟过期；在线爆破由注册接口的 per-email 限流拦截
// - 完全无状态，无需数据库表/迁移，dev server 重启不影响已颁发令牌的有效性
const EMAIL_CODE_TTL_SEC = 5 * 60;

interface EmailCodePayload {
  purpose: 'email-code';
  email: string;
  nonce: string;
  exp: number; // 秒
}

/** 颁发邮箱验证码：返回 { token(给前端), code(发邮件), expiresInSec } */
export function issueEmailCode(email: string): { token: string; code: string; expiresInSec: number } {
  email = normalizeEmail(email);
  const nonce = randomBytes(8).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + EMAIL_CODE_TTL_SEC;
  const payload: EmailCodePayload = { purpose: 'email-code', email, nonce, exp };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = sign(`${header}.${body}`);
  const token = `${header}.${body}.${sig}`;
  return { token, code: deriveEmailCode(email, nonce, exp), expiresInSec: EMAIL_CODE_TTL_SEC };
}

function deriveEmailCode(email: string, nonce: string, exp: number): string {
  const hmac = createHmac('sha256', getJwtSecret()).update(`email-code:${email}:${nonce}:${exp}`).digest('hex');
  const num = parseInt(hmac.slice(0, 12), 16) % 1_000_000;
  return num.toString().padStart(6, '0');
}

/**
 * 校验邮箱验证码。
 * - token 使用与 JWT 相同的 HMAC 封装，但按邮箱验证码自己的载荷结构验证
 * - 再校验 purpose/email 一致，并用常量时间比较验证码
 */
export function verifyEmailCode(token: string, email: string, code: string): boolean {
  email = normalizeEmail(email);
  const raw = verifySignedPayload(token);
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as unknown as EmailCodePayload;
  if (p.purpose !== 'email-code') return false;
  if (typeof p.email !== 'string' || p.email !== email) return false;
  if (typeof p.nonce !== 'string' || typeof p.exp !== 'number') return false;
  if (!Number.isInteger(p.exp) || p.exp <= Math.floor(Date.now() / 1000)) return false;
  const expected = deriveEmailCode(email, p.nonce, p.exp);
  try {
    const a = Buffer.from((code || '').trim());
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ─── 密码哈希（scrypt）───
function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** 哈希密码，返回 `scrypt$N$r$p$saltHex$hashHex` */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** 校验密码，常量时间比较 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  try {
    const hash = await new Promise<Buffer>((resolve, reject) => {
      scryptCb(password, salt, expected.length, { N, r, p }, (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
    return hash.length === expected.length && timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

// ─── Cookie 工具 ───
function isProd() {
  return process.env.NODE_ENV === 'production';
}

function shouldUseSecureCookie() {
  if (process.env.AUTH_COOKIE_SECURE === 'false') return false;
  return isProd();
}

export function authCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/** 清除认证 Cookie */
export function clearAuthCookie(res: NextResponse): NextResponse {
  res.cookies.set(AUTH_COOKIE, '', authCookieOptions(0));
  return res;
}

/** 从请求中读取认证 Cookie */
export function getAuthCookie(request: NextRequest): string | undefined {
  return request.cookies.get(AUTH_COOKIE)?.value;
}
