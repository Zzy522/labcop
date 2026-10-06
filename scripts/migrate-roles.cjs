// 角色精简迁移脚本：将 PI/SAFETY_OFFICER/LAB_MANAGER 统一为 ADMIN
// 用法： node scripts/migrate-roles.cjs
const { PrismaClient } = require('../src/generated/prisma/client');
const { PrismaLibSql } = require('@prisma/adapter-libsql');

const adapter = new PrismaLibSql({ url: 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });

(async () => {
  console.log('=== 角色精简迁移开始 ===');
  const before = await prisma.user.groupBy({ by: ['role'], _count: true });
  console.log('迁移前角色分布:', JSON.stringify(before));

  const result = await prisma.user.updateMany({
    where: { role: { in: ['PI', 'SAFETY_OFFICER', 'LAB_MANAGER'] } },
    data: { role: 'ADMIN' },
  });
  console.log(`已将 ${result.count} 个用户更新为 ADMIN`);

  const after = await prisma.user.groupBy({ by: ['role'], _count: true });
  console.log('迁移后角色分布:', JSON.stringify(after));
  console.log('=== 迁移完成 ===');
  await prisma.$disconnect();
})().catch((e) => {
  console.error('迁移失败:', e);
  process.exit(1);
});
