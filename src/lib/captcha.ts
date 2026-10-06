/**
 * 图形验证码（零第三方依赖，纯 SVG + 数据库挑战记录）
 *
 * - 图片通过同源 /api/auth/captcha/:id/image 返回，不依赖 data: URL。
 * - 答案只保存 HMAC，不保存明文；3 分钟有效，最多尝试 3 次。
 * - 数据库 updateMany 原子消费，支持多 Node 进程并避免重复使用。
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';

const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const TTL_MS = 3 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CLEANUP_INTERVAL_MS = 60 * 1000;

// 5×7 点阵字形。验证码响应只包含绘制路径，不包含可被脚本直接读取的明文字母。
const BITMAP_FONT: Record<string, readonly string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

let lastCleanup = 0;

function getCaptchaSecret(): string {
  const secret = process.env.CAPTCHA_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('生产环境必须配置 CAPTCHA_SECRET 或 JWT_SECRET');
    }
    return 'dev-insecure-captcha-secret-do-not-use-in-prod';
  }
  return secret;
}

function randomChars(length: number): string {
  let value = '';
  for (let index = 0; index < length; index++) value += CHARS[randomInt(CHARS.length)];
  return value;
}

function pick<T>(values: readonly T[]): T {
  return values[randomInt(values.length)];
}

function answerHash(id: string, answer: string): string {
  return createHmac('sha256', getCaptchaSecret())
    .update(`captcha:${id}:${answer.trim().toLowerCase()}`)
    .digest('hex');
}

function hashesEqual(left: string, right: string): boolean {
  try {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** 生成安全、无脚本的验证码 SVG。 */
export function renderCaptchaSvg(text: string): string {
  const width = 130;
  const height = 44;
  const colors = ['#0d9488', '#2563eb', '#db2777', '#7c3aed', '#ea580c', '#16a34a'];

  let lines = '';
  for (let index = 0; index < 5; index++) {
    const x1 = randomInt(0, width);
    const y1 = randomInt(0, height);
    const x2 = randomInt(0, width);
    const y2 = randomInt(0, height);
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${pick(colors)}" stroke-width="1" opacity="0.35"/>`;
  }

  let dots = '';
  for (let index = 0; index < 24; index++) {
    dots += `<circle cx="${randomInt(0, width)}" cy="${randomInt(0, height)}" r="${randomInt(1, 3)}" fill="${pick(colors)}" opacity="0.3"/>`;
  }

  let glyphs = '';
  const slot = width / (CODE_LENGTH + 1);
  for (let index = 0; index < CODE_LENGTH; index++) {
    const character = text[index];
    const pattern = BITMAP_FONT[character] || BITMAP_FONT.A;
    const pixelSize = 4;
    const glyphWidth = 5 * pixelSize;
    const glyphHeight = 7 * pixelSize;
    const x = Math.round(slot * (index + 1) - glyphWidth / 2);
    const y = Math.round((height - glyphHeight) / 2 + randomInt(-3, 4));
    const rotation = randomInt(-22, 22);
    let path = '';
    for (let row = 0; row < pattern.length; row++) {
      for (let column = 0; column < pattern[row].length; column++) {
        if (pattern[row][column] !== '1') continue;
        const px = x + column * pixelSize + randomInt(-1, 2);
        const py = y + row * pixelSize + randomInt(-1, 2);
        path += `M${px} ${py}h3v3h-3z`;
      }
    }
    const centerX = x + glyphWidth / 2;
    const centerY = y + glyphHeight / 2;
    glyphs += `<path d="${path}" fill="${pick(colors)}" transform="rotate(${rotation} ${centerX} ${centerY})"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="图形验证码" shape-rendering="geometricPrecision"><rect width="${width}" height="${height}" fill="#f8fafc"/>${lines}${dots}${glyphs}</svg>`;
}

async function cleanupChallenges(now: Date): Promise<void> {
  if (now.getTime() - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now.getTime();
  await prisma.captchaChallenge.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { consumedAt: { not: null }, createdAt: { lt: new Date(now.getTime() - TTL_MS) } },
      ],
    },
  });
}

export async function generateCaptcha(): Promise<{ id: string; imageUrl: string; expiresInSec: number }> {
  const now = new Date();
  await cleanupChallenges(now);

  // 128 位随机 ID，碰撞概率可忽略；数据库主键仍提供最终唯一性保证。
  const id = randomBytes(16).toString('hex');
  const text = randomChars(CODE_LENGTH);
  await prisma.captchaChallenge.create({
    data: {
      id,
      answerHash: answerHash(id, text),
      svg: renderCaptchaSvg(text),
      expiresAt: new Date(now.getTime() + TTL_MS),
    },
  });

  return {
    id,
    imageUrl: `/api/auth/captcha/${id}/image`,
    expiresInSec: Math.floor(TTL_MS / 1000),
  };
}

export async function getCaptchaSvg(id: string): Promise<string | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const challenge = await prisma.captchaChallenge.findUnique({
    where: { id },
    select: { svg: true, expiresAt: true, consumedAt: true, attempts: true },
  });
  if (!challenge || challenge.consumedAt || challenge.attempts >= MAX_ATTEMPTS || challenge.expiresAt <= new Date()) {
    return null;
  }
  return challenge.svg;
}

/** 校验并原子消费验证码；成功后同一验证码不能再次使用。 */
export async function verifyCaptcha(id: string, input: string): Promise<boolean> {
  if (!/^[a-f0-9]{32}$/.test(id) || !input.trim()) return false;
  const now = new Date();
  const challenge = await prisma.captchaChallenge.findUnique({
    where: { id },
    select: { answerHash: true, expiresAt: true, consumedAt: true, attempts: true },
  });
  if (!challenge || challenge.consumedAt || challenge.attempts >= MAX_ATTEMPTS || challenge.expiresAt <= now) {
    return false;
  }

  const correct = hashesEqual(challenge.answerHash, answerHash(id, input));
  if (!correct) {
    await prisma.captchaChallenge.updateMany({
      where: { id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    return false;
  }

  const consumed = await prisma.captchaChallenge.updateMany({
    where: {
      id,
      answerHash: challenge.answerHash,
      consumedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: MAX_ATTEMPTS },
    },
    data: { consumedAt: now },
  });
  return consumed.count === 1;
}
