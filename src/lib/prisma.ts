import { PrismaClient } from '@/generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error('生产环境必须显式配置 DATABASE_URL');
}

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
});

// 开发服务器会跨热更新复用 globalThis；Schema 新增模型后，旧 Client 实例不会自动获得新 delegate。
// 版本变化时重新创建实例，避免出现 prisma.documentReagent 为 undefined。
const PRISMA_SCHEMA_VERSION = '20260925150000';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaSchemaVersion: string | undefined;
};

export const prisma = globalForPrisma.prisma && globalForPrisma.prismaSchemaVersion === PRISMA_SCHEMA_VERSION
  ? globalForPrisma.prisma
  : new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaVersion = PRISMA_SCHEMA_VERSION;
}
