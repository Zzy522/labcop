/**
 * 认证相关速率限制 + 登录失败锁定
 *
 * - 登录失败锁定：同一邮箱连续失败 5 次后锁定 15 分钟，期间拒绝登录
 * - 注册限流：复用通用 token bucket（在路由内调用 checkRateLimit）
 * - 内存方案，仅适用于单实例部署；多实例需换 Redis
 *
 * 安全设计：失败计数按邮箱（防账号枚举时也统一计数，避免探测）；
 * 锁定窗口与计数窗口一致，过期自动清理，Map 不会无限增长。
 */
import type { NextRequest } from 'next/server';
import { isIP } from 'node:net';

interface LoginAttempt {
  fails: number;
  windowStart: number;
  lockedUntil: number;
}

const attempts = new Map<string, LoginAttempt>();
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 计数窗口 15 分钟
const LOCK_MS = 15 * 60 * 1000; // 锁定时长 15 分钟

let lastSweep = Date.now();
const SWEEP_INTERVAL = 5 * 60 * 1000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL) return;
  lastSweep = now;
  for (const [k, a] of attempts) {
    // 窗口外且未锁定 → 清理
    if (now - a.windowStart > WINDOW_MS && a.lockedUntil < now) {
      attempts.delete(k);
    }
  }
}

export interface LockStatus {
  locked: boolean;
  retryAfterMs: number;
}

/** 查询邮箱是否被锁定 */
export function isLocked(key: string): LockStatus {
  const now = Date.now();
  sweep(now);
  const a = attempts.get(key);
  if (a && a.lockedUntil > now) {
    return { locked: true, retryAfterMs: a.lockedUntil - now };
  }
  return { locked: false, retryAfterMs: 0 };
}

export interface FailResult {
  locked: boolean;
  retryAfterMs: number;
  attempts: number;
  remaining: number;
}

/** 记录一次失败登录，返回当前状态（可能触发锁定） */
export function recordFailedLogin(key: string): FailResult {
  const now = Date.now();
  sweep(now);
  let a = attempts.get(key);
  if (!a || now - a.windowStart > WINDOW_MS) {
    // 新窗口
    a = { fails: 0, windowStart: now, lockedUntil: 0 };
    attempts.set(key, a);
  }
  a.fails += 1;
  if (a.fails >= MAX_FAILS) {
    a.lockedUntil = now + LOCK_MS;
    return { locked: true, retryAfterMs: LOCK_MS, attempts: a.fails, remaining: 0 };
  }
  return { locked: false, retryAfterMs: 0, attempts: a.fails, remaining: MAX_FAILS - a.fails };
}

/** 登录成功后重置计数 */
export function resetLogin(key: string): void {
  attempts.delete(key);
}

/**
 * 提取由受信任反向代理覆盖写入的客户端 IP。
 *
 * 安全边界：生产 Compose 不暴露 app:3000，只有 Nginx 能访问应用；Nginx 必须用
 * `$remote_addr` 覆盖 X-Real-IP，而不能信任/转发客户端自带的 X-Forwarded-For。
 * 缺失或格式异常时使用统一的 unknown 桶，采取 fail-closed 行为。
 */
export function getClientIp(request: NextRequest): string {
  const candidate = request.headers.get('x-real-ip')?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate.toLowerCase() : 'unknown';
}
