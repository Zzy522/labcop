/**
 * 实验室加入码工具
 *
 * 设计：
 * - 6 位字符，使用去除易混淆字符（O/0/I/1）的字母表，降低口述/识别错误率
 * - 大写存储，输入时归一化（去空格、转大写、剔非法字符）
 * - 唯一性由数据库 @unique 约束保证；生成时重试避免极小概率冲突
 */
import { randomBytes } from 'node:crypto';

// 去除 O / 0 / I / 1 / L 等易混淆字符
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;

/** 生成一个 6 位加入码 */
export function generateJoinCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
}

/** 归一化用户输入的加入码（去空格、转大写、剔非法字符） */
export function normalizeJoinCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
}

/** 校验加入码格式（6 位合法字符） */
export function isValidJoinCodeFormat(input: string): boolean {
  const normalized = normalizeJoinCode(input);
  return normalized.length === CODE_LEN && /^[A-Z2-9]+$/.test(normalized);
}
