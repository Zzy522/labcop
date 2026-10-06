import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
});

const prisma = new PrismaClient({ adapter });

async function main() {
  // 1. 查看现有实验室
  const labs = await prisma.lab.findMany({ select: { id: true, name: true, location: true } });
  console.log('现有实验室:');
  console.log(JSON.stringify(labs, null, 2));

  if (labs.length === 0) {
    console.error('未找到实验室，请先运行 npm run seed 初始化数据');
    process.exit(1);
  }

  // 使用第一个实验室作为测试账号所属实验室
  const targetLab = labs[0];
  console.log(`\n将测试账号分配到实验室: ${targetLab.name} (${targetLab.id})`);

  // 2. 查看现有用户
  const existingUsers = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, labId: true },
  });
  console.log('\n现有用户:');
  console.log(JSON.stringify(existingUsers, null, 2));

  // 3. 待创建的实验员账号（MEMBER 角色）
  const testUsers = [
    { name: '陈实验员', email: 'tester1@lab.edu.cn' },
    { name: '林测试', email: 'tester2@lab.edu.cn' },
    { name: '周科研', email: 'tester3@lab.edu.cn' },
    { name: '吴博士', email: 'tester4@lab.edu.cn' },
    { name: '郑助理', email: 'tester5@lab.edu.cn' },
  ];

  // 4. 创建不存在的用户（互不影响：跳过已存在的 email）
  const created = [];
  const skipped = [];
  for (const u of testUsers) {
    const exists = existingUsers.some((e) => e.email === u.email);
    if (exists) {
      skipped.push(u);
      continue;
    }
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        password: '$2a$10$placeholder_test_user',
        role: 'MEMBER',
        labId: targetLab.id,
      },
      select: { id: true, name: true, email: true, role: true, labId: true },
    });
    created.push(user);
  }

  console.log('\n✅ 已创建的测试账号:');
  console.log(JSON.stringify(created, null, 2));

  if (skipped.length > 0) {
    console.log('\n⏭️  已跳过（已存在）的账号:');
    console.log(JSON.stringify(skipped, null, 2));
  }

  // 5. 输出最终用户列表
  const finalUsers = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, labId: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\n📋 最终用户列表:');
  console.log(JSON.stringify(finalUsers, null, 2));

  console.log('\n💡 登录说明：登录时不验证密码，直接使用 email 即可登录');
  console.log('   测试账号 email：');
  testUsers.forEach((u) => console.log(`   - ${u.email}`));
}

main()
  .catch((e) => {
    console.error('执行失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
