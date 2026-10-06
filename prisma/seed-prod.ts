/** 生产环境只初始化 PLATFORM_ADMIN；实验室必须通过公开申请与平台审批产生。 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { hashPassword } from '../src/lib/auth';

const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }) });

async function main() {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  const name = process.env.PLATFORM_ADMIN_NAME || '平台管理员';
  if (!email || !password) throw new Error('缺少 PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD');
  if (password.length < 16) throw new Error('PLATFORM_ADMIN_PASSWORD 至少 16 位');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.platformRole !== 'PLATFORM_ADMIN') throw new Error('该邮箱已被普通账号占用，拒绝自动提权');
    console.log(`✓ PLATFORM_ADMIN ${email} 已存在，跳过初始化`); return;
  }
  await prisma.user.create({ data: { name, email: email.toLowerCase(), password: await hashPassword(password), emailVerified: new Date(), role: 'MEMBER', platformRole: 'PLATFORM_ADMIN', status: 'ACTIVE', statusChangedAt: new Date() } });
  console.log(`✓ PLATFORM_ADMIN ${email} 初始化完成（未创建实验室）`);
}
main().catch((e)=>{console.error('❌ 初始化失败:',e);process.exit(1)}).finally(()=>prisma.$disconnect());
