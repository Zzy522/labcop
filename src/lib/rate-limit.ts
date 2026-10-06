/**
 * 速率限制 — 内存 Token Bucket
 *
 * 设计：
 * - 按 `key`（通常为 userId + 路由分组）维护一个令牌桶
 * - 每秒按 refillRate 补充令牌，上限 capacity
 * - 请求消耗 1 个令牌；不足则拒绝
 *
 * 限制说明：
 * - 内存方案，仅适用于单实例部署（Next.js 自托管 / Docker 单容器）
 * - Serverless / 多实例环境需替换为 Redis 实现（接口保持 checkRateLimit 不变即可无缝切换）
 * - 桶数量会随用户增长，内置 5 分钟惰性清理空闲桶避免内存膨胀
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();
const IDLE_TTL_MS = 5 * 60 * 1000; // 5 分钟未访问的桶可被清理
let lastSweep = Date.now();

function refill(bucket: Bucket, capacity: number, refillPerSec: number, now: number) {
  const elapsed = (now - bucket.lastRefill) / 1000;
  if (elapsed > 0) {
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSec);
    bucket.lastRefill = now;
  }
}

function sweepIdle(now: number) {
  if (now - lastSweep < IDLE_TTL_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (now - b.lastRefill > IDLE_TTL_MS) buckets.delete(k);
  }
}

export interface RateLimitConfig {
  /** 桶容量（最大瞬时请求数） */
  capacity: number;
  /** 每秒补充令牌数 */
  refillPerSec: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 剩余令牌 */
  remaining: number;
  /** 建议重试等待毫秒数（被拒绝时） */
  retryAfterMs: number;
}

/**
 * 检查速率限制。
 * @param key 分组键，建议格式 `${userId}:${routeGroup}`
 * @param config 桶配置
 * @returns allowed=false 时应返回 429
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  sweepIdle(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.capacity, lastRefill: now };
    buckets.set(key, bucket);
  }
  refill(bucket, config.capacity, config.refillPerSec, now);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
  }
  // 计算需等待多久才有 1 个令牌
  const retryAfterMs = Math.ceil((1 - bucket.tokens) / config.refillPerSec * 1000);
  return { allowed: false, remaining: 0, retryAfterMs: Math.max(retryAfterMs, 500) };
}

/** 预设配置：按路由分组复用 */
export const RATE_LIMIT_PRESETS = {
  /** AI 助手聊天：每用户 10 次/分钟突发，每秒恢复 0.5 次 */
  assistantChat: { capacity: 10, refillPerSec: 0.5 },
  /** OCR 识别：每用户 5 次/分钟突发，每秒恢复 0.2 次（OCR 成本高） */
  ocr: { capacity: 5, refillPerSec: 0.2 },
  /** PubChem 查询：每用户 20 次/分钟突发，每秒恢复 1 次（PubChem 限 5 req/s） */
  pubchem: { capacity: 20, refillPerSec: 1 },
} as const satisfies Record<string, RateLimitConfig>;

// ─── 每日计数限流（固定上限，按自然日重置）───
//
// 适用于「每天最多 N 次」类硬上限场景（如发送验证码 IP 100 次/天）。
// 与 token bucket 不同：不平滑补充，达到上限后当日不再放行，次日 0 点重置。
// 同样为内存方案，单实例适用；多实例需替换为 Redis。

interface DailyCounter {
  /** YYYY-MM-DD（服务器本地日） */
  day: string;
  count: number;
}

const dailyCounters = new Map<string, DailyCounter>();

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface DailyLimitResult {
  allowed: boolean;
  /** 今日已用次数 */
  used: number;
  /** 今日剩余次数 */
  remaining: number;
  /** 距次日 0 点的毫秒数（被拒绝时用于 Retry-After） */
  retryAfterMs: number;
}

/**
 * 检查每日上限。每次调用占用 1 次配额；达到上限返回 allowed=false。
 * @param key 分组键，如 `send-code:ip:1.2.3.4`
 * @param max 每日最大次数
 */
export function checkDailyLimit(key: string, max: number): DailyLimitResult {
  const today = todayStr();
  let counter = dailyCounters.get(key);
  if (!counter || counter.day !== today) {
    counter = { day: today, count: 0 };
    dailyCounters.set(key, counter);
  }

  if (counter.count >= max) {
    // 计算到次日 0 点的毫秒数
    const next = new Date();
    next.setHours(24, 0, 0, 0);
    return { allowed: false, used: counter.count, remaining: 0, retryAfterMs: next.getTime() - Date.now() };
  }

  counter.count += 1;
  return { allowed: true, used: counter.count, remaining: max - counter.count, retryAfterMs: 0 };
}
