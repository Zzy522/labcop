/**
 * 回填脚本：为现有试剂设置 totalStockedBottles（累计入库瓶数）
 *
 * 规则：totalStockedBottles = SUM(ReagentLog.quantity WHERE action='STOCK_IN')
 * 无 STOCK_IN 记录的试剂，回退到当前 stockQuantity（兼容无台账的旧数据）
 *
 * 运行：npx tsx scripts/backfill-total-stocked-bottles.ts
 */
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { config } from 'dotenv';

config();

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
});

async function main() {
  const prisma = new PrismaClient({ adapter });
  try {
    const reagents = await prisma.reagent.findMany({
      select: { id: true, name: true, stockQuantity: true, totalStockedBottles: true },
    });
    console.log(`[backfill] 共 ${reagents.length} 条试剂需要检查`);

    let updated = 0;
    let skipped = 0;
    for (const r of reagents) {
      // 已有值且 > 0 的跳过（避免重复回填）
      if (r.totalStockedBottles && r.totalStockedBottles > 0) {
        skipped++;
        continue;
      }
      // 聚合所有 STOCK_IN 日志
      const logs = await prisma.reagentLog.findMany({
        where: { reagentId: r.id, action: 'STOCK_IN' },
        select: { quantity: true },
      });
      const totalStockedIn = logs.reduce((sum, l) => sum + l.quantity, 0);
      // 有 STOCK_IN 日志则用累计值，否则回退到当前 stockQuantity
      const value = logs.length > 0 ? totalStockedIn : r.stockQuantity;
      await prisma.reagent.update({
        where: { id: r.id },
        data: { totalStockedBottles: value },
      });
      updated++;
      console.log(`  ✓ ${r.name}: totalStockedBottles = ${value} (logs: ${logs.length}, stockQty: ${r.stockQuantity})`);
    }
    console.log(`[backfill] 完成：更新 ${updated} 条，跳过 ${skipped} 条（已有值）`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('[backfill] 失败:', e);
  process.exit(1);
});
