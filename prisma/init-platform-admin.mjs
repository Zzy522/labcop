/**
 * 低依赖的平台管理员初始化脚本。
 * 使用 Node + Prisma 适配器，避免 Windows 上 tsx 临时目录异常阻断首次初始化。
 */
import 'dotenv/config';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client';

const scrypt = promisify(scryptCallback);
const databaseUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
const client = createClient({ url: databaseUrl });

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${Buffer.from(hash).toString('hex')}`;
}

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const name = process.env.PLATFORM_ADMIN_NAME?.trim() || '平台管理员';
  if (!email || !password) throw new Error('缺少 PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD');
  if (password.length < 16) throw new Error('PLATFORM_ADMIN_PASSWORD 至少 16 位');
  const existingResult = await client.execute({ sql: 'SELECT id, platformRole FROM User WHERE email = ? LIMIT 1', args: [email] });
  const existing = existingResult.rows[0];
  if (existing) {
    if (existing.platformRole !== 'PLATFORM_ADMIN') throw new Error('该邮箱已被普通账号占用，拒绝自动提权');
    console.log(`✓ PLATFORM_ADMIN ${email} 已存在，未重置现有密码`);
    return;
  }
  const id = `platform_${randomBytes(12).toString('hex')}`;
  const passwordHash = await hashPassword(password);
  await client.execute({
    sql: `INSERT INTO User (id, name, email, password, emailVerified, role, platformRole, status, statusChangedAt, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'MEMBER', 'PLATFORM_ADMIN', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    args: [id, name, email, passwordHash],
  });
  console.log(`✓ PLATFORM_ADMIN ${email} 初始化完成`);
}

main().catch((error)=>{console.error('❌ 初始化失败:',error);process.exitCode=1;}).finally(()=>client.close());
