/**
 * 一次性令牌工具
 *
 * 安全设计：
 * - 令牌原文为 32 字节随机数（256 bit），发送给用户（邮件链接）
 * - 数据库只存 SHA-256 哈希，即便数据库泄露也无法直接重放
 * - 校验时对用户提交的令牌做同样哈希后比对
 */
import { randomBytes, createHash } from 'node:crypto';

/** 生成令牌原文（发送给用户） */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** 计算令牌哈希（存入数据库） */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 令牌有效期 30 分钟 */
export const TOKEN_TTL_MS = 30 * 60 * 1000;
