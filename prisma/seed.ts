import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { hashPassword } from '../src/lib/auth';

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEVELOPMENT_SEED !== 'yes' || !/^file:.*(?:dev|test)[^/\\]*\.db$/.test(process.env.DATABASE_URL || '')) {
  throw new Error('开发 seed 仅允许显式授权的 dev/test.db：设置 ALLOW_DEVELOPMENT_SEED=yes；禁止生产环境');
}

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? 'file:./dev.db',
});

const prisma = new PrismaClient({ adapter });

async function main() {
  // 默认密码（所有 seed 用户统一为 123456，便于本地开发登录）
  const defaultPassword = await hashPassword('123456');
  // 清空已有数据
  // 课题数据采用追加式历史，初始化开发库时必须按依赖顺序显式清理。
  await prisma.captchaChallenge.deleteMany();
  await prisma.platformAuditLog.deleteMany();
  await prisma.authSession.deleteMany();
  await prisma.registrationApplication.deleteMany();
  await prisma.collegeMembership.deleteMany();
  await prisma.labMembership.deleteMany();
  await prisma.projectChangeLog.deleteMany();
  await prisma.projectBackupSnapshot.deleteMany();
  await prisma.projectAiSummary.deleteMany();
  await prisma.projectWeeklyReportAttachment.deleteMany();
  await prisma.projectWeeklyReport.deleteMany();
  await prisma.projectDocumentReview.deleteMany();
  await prisma.projectDocumentVersion.deleteMany();
  await prisma.projectDocument.deleteMany();
  await prisma.projectTaskChangeRequest.deleteMany();
  await prisma.projectTaskAssignee.deleteMany();
  await prisma.projectTaskUpdate.deleteMany();
  await prisma.projectPhaseTask.deleteMany();
  await prisma.projectCompound.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.researchProject.deleteMany();
  await prisma.inspection.deleteMany();
  await prisma.riskEvent.deleteMany();
  await prisma.requisition.deleteMany();
  await prisma.deviceUsage.deleteMany();
  await prisma.reagentLog.deleteMany();
  await prisma.document.deleteMany();
  await prisma.reagent.deleteMany();
  await prisma.device.deleteMany();
  await prisma.user.deleteMany();
  await prisma.lab.deleteMany();

  // ─── 创建实验室 ───
  const lab = await prisma.lab.create({
    data: {
      name: '有机合成实验室',
      location: '化学楼3层301',
      description: '从事有机合成相关研究课题的实验室',
      joinCode: 'ORG001',
    },
  });

  // ─── 创建用户（角色精简：ADMIN + MEMBER）───
  const admin = await prisma.user.create({
    data: {
      name: '管理员',
      email: 'admin@lab.edu.cn',
      password: defaultPassword,
      role: 'ADMIN',
      labId: lab.id,
    },
  });

  const admin2 = await prisma.user.create({
    data: {
      name: '李管理',
      email: 'admin2@lab.edu.cn',
      password: defaultPassword,
      role: 'ADMIN',
      labId: lab.id,
    },
  });

  const admin3 = await prisma.user.create({
    data: {
      name: '王安全',
      email: 'safety@lab.edu.cn',
      password: defaultPassword,
      role: 'ADMIN',
      labId: lab.id,
    },
  });

  const member = await prisma.user.create({
    data: {
      name: '赵实验',
      email: 'member@lab.edu.cn',
      password: defaultPassword,
      role: 'MEMBER',
      labId: lab.id,
    },
  });

  await prisma.labMembership.createMany({ data: [
    { labId: lab.id, userId: admin.id, role: 'LAB_OWNER', status: 'ACTIVE', isPrimary: true, approvedAt: new Date() },
    { labId: lab.id, userId: admin2.id, role: 'LAB_ADMIN', status: 'ACTIVE', isPrimary: true, approvedById: admin.id, approvedAt: new Date() },
    { labId: lab.id, userId: admin3.id, role: 'LAB_ADMIN', status: 'ACTIVE', isPrimary: true, approvedById: admin.id, approvedAt: new Date() },
    { labId: lab.id, userId: member.id, role: 'LAB_MEMBER', status: 'ACTIVE', isPrimary: true, approvedById: admin.id, approvedAt: new Date() },
  ] });

  // 设置核心管理员（第一个管理员为实验室创建者/核心管理员）
  await prisma.lab.update({
    where: { id: lab.id },
    data: { ownerId: admin.id },
  });

  // ─── 创建试剂 ───
  const now = new Date();
  const daysFromNow = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d;
  };

  const reagents = await Promise.all([
    // 危化品 - 高风险
    prisma.reagent.create({
      data: {
        name: '浓硫酸',
        casNumber: '7664-93-9',
        specification: '500mL/瓶',
        brand: '国药集团',
        dangerCategory: '腐蚀品',
        riskLevel: 'HIGH',
        isHazardous: true,
        storageLocation: '危化品柜A-01',
        stockQuantity: 5,
        minStock: 3,
        unit: '瓶',
        batchNumber: 'HG20250301',
        expiryDate: daysFromNow(365),
        labId: lab.id,
      },
    }),
    // 危化品 - 高风险，低库存
    prisma.reagent.create({
      data: {
        name: '丙酮',
        casNumber: '67-64-1',
        specification: '2.5L/瓶',
        brand: '西陇科学',
        dangerCategory: '易燃液体',
        riskLevel: 'HIGH',
        isHazardous: true,
        storageLocation: '易燃品柜B-03',
        stockQuantity: 2,
        minStock: 5,
        unit: '瓶',
        batchNumber: 'XL20240815',
        expiryDate: daysFromNow(180),
        labId: lab.id,
      },
    }),
    // 危化品 - 临期
    prisma.reagent.create({
      data: {
        name: '甲苯',
        casNumber: '108-88-3',
        specification: '500mL/瓶',
        brand: '阿拉丁',
        dangerCategory: '易燃液体',
        riskLevel: 'HIGH',
        isHazardous: true,
        storageLocation: '易燃品柜B-05',
        stockQuantity: 8,
        minStock: 3,
        unit: '瓶',
        batchNumber: 'ALD20231201',
        expiryDate: daysFromNow(15),
        labId: lab.id,
      },
    }),
    // 危化品 - 已过期
    prisma.reagent.create({
      data: {
        name: '乙酸乙酯',
        casNumber: '141-78-6',
        specification: '500mL/瓶',
        brand: '国药集团',
        dangerCategory: '易燃液体',
        riskLevel: 'HIGH',
        isHazardous: true,
        storageLocation: '易燃品柜B-02',
        stockQuantity: 3,
        minStock: 2,
        unit: '瓶',
        batchNumber: 'HG20230101',
        expiryDate: daysFromNow(-30),
        labId: lab.id,
      },
    }),
    // 普通试剂 - 中风险
    prisma.reagent.create({
      data: {
        name: '氯化钠',
        casNumber: '7647-14-5',
        specification: '500g/瓶',
        brand: '国药集团',
        riskLevel: 'LOW',
        isHazardous: false,
        storageLocation: '普通试剂架C-12',
        stockQuantity: 20,
        minStock: 5,
        unit: '瓶',
        batchNumber: 'HG20250101',
        expiryDate: daysFromNow(730),
        labId: lab.id,
      },
    }),
    // 普通试剂 - 低库存
    prisma.reagent.create({
      data: {
        name: '氢氧化钠',
        casNumber: '1310-73-2',
        specification: '500g/瓶',
        brand: '西陇科学',
        dangerCategory: '腐蚀品',
        riskLevel: 'HIGH',
        isHazardous: false,
        storageLocation: '普通试剂架C-08',
        stockQuantity: 1,
        minStock: 3,
        unit: '瓶',
        batchNumber: 'XL20240601',
        expiryDate: daysFromNow(365),
        labId: lab.id,
      },
    }),
    // 普通试剂
    prisma.reagent.create({
      data: {
        name: '无水乙醇',
        casNumber: '64-17-5',
        specification: '2.5L/瓶',
        brand: '国药集团',
        dangerCategory: '易燃液体',
        riskLevel: 'LOW',
        isHazardous: false,
        storageLocation: '普通试剂架D-01',
        stockQuantity: 10,
        minStock: 5,
        unit: '瓶',
        batchNumber: 'HG20250215',
        expiryDate: daysFromNow(540),
        labId: lab.id,
      },
    }),
    // 普通试剂 - 临近过期
    prisma.reagent.create({
      data: {
        name: '石油醚',
        casNumber: '8032-32-4',
        specification: '500mL/瓶',
        brand: '阿拉丁',
        dangerCategory: '易燃液体',
        riskLevel: 'HIGH',
        isHazardous: false,
        storageLocation: '易燃品柜B-07',
        stockQuantity: 6,
        minStock: 3,
        unit: '瓶',
        batchNumber: 'ALD20230901',
        expiryDate: daysFromNow(22),
        labId: lab.id,
      },
    }),
  ]);

  // ─── 创建设备 ───
  // 注意：status='IN_USE' 的设备必须同时创建 DeviceUsage 记录，保持数据一致性。
  // 正常流程中 applyDeviceUsage() 会原子性地同时创建使用记录+更新状态，seed 需模拟此一致性。
  const devices = await Promise.all([
    prisma.device.create({
      data: {
        name: '气相色谱仪',
        model: 'GC-2014',
        serialNumber: 'SHIM-2024-001',
        location: '分析室A-01',
        riskLevel: 'HIGH',
        status: 'IN_USE',
        labId: lab.id,
      },
    }),
    prisma.device.create({
      data: {
        name: '旋转蒸发仪',
        model: 'RE-52AA',
        serialNumber: 'YAR-2023-003',
        location: '合成室B-02',
        riskLevel: 'MEDIUM',
        status: 'IN_USE',
        labId: lab.id,
      },
    }),
    prisma.device.create({
      data: {
        name: '通风橱',
        model: 'FH-1200',
        serialNumber: 'DL-2022-012',
        location: '合成室B-01',
        riskLevel: 'LOW',
        status: 'MAINTENANCE',
        labId: lab.id,
      },
    }),
    prisma.device.create({
      data: {
        name: '紫外分光光度计',
        model: 'UV-1800',
        serialNumber: 'SHIM-2021-007',
        location: '分析室A-03',
        riskLevel: 'LOW',
        status: 'IDLE',
        labId: lab.id,
      },
    }),
  ]);

  // ─── 为 IN_USE 设备创建活跃使用记录（保持数据一致性）───
  await Promise.all([
    prisma.deviceUsage.create({
      data: {
        deviceId: devices[0].id, // 气相色谱仪
        userId: member.id,
        startTime: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2小时前开始
        endTime: null, // 进行中，未结束
        purpose: '有机产物组分分析',
        status: 'NORMAL',
      },
    }),
    prisma.deviceUsage.create({
      data: {
        deviceId: devices[1].id, // 旋转蒸发仪
        userId: admin2.id,
        startTime: new Date(now.getTime() - 30 * 60 * 1000), // 30分钟前开始
        endTime: null, // 进行中，未结束
        purpose: '减压蒸馏除去反应溶剂',
        status: 'NORMAL',
      },
    }),
  ]);

  // ─── 创建领用申请 ───
  await Promise.all([
    // 待审查
    prisma.requisition.create({
      data: {
        reagentId: reagents[0].id,
        applicantId: member.id,
        quantity: 1,
        purpose: '有机合成实验需要使用浓硫酸作为催化剂',
        status: 'PENDING',
      },
    }),
    // 待审查
    prisma.requisition.create({
      data: {
        reagentId: reagents[1].id,
        applicantId: member.id,
        quantity: 2,
        purpose: '反应溶剂',
        status: 'PENDING',
      },
    }),
    // 待确认
    prisma.requisition.create({
      data: {
        reagentId: reagents[2].id,
        applicantId: member.id,
        quantity: 1,
        purpose: '液相色谱流动相',
        status: 'NEEDS_CONFIRM',
        reviewedById: admin3.id,
        reviewedAt: daysFromNow(-1),
      },
    }),
    // 已批准
    prisma.requisition.create({
      data: {
        reagentId: reagents[4].id,
        applicantId: member.id,
        quantity: 2,
        purpose: '配制缓冲溶液',
        status: 'APPROVED',
        reviewedById: admin3.id,
        reviewedAt: daysFromNow(-3),
      },
    }),
    // 已驳回
    prisma.requisition.create({
      data: {
        reagentId: reagents[0].id,
        applicantId: member.id,
        quantity: 3,
        purpose: '个人课题研究',
        status: 'REJECTED',
        reviewedById: admin3.id,
        reviewedAt: daysFromNow(-5),
      },
    }),
  ]);

  // ─── 创建风险事件 ───
  await Promise.all([
    // 低库存预警
    prisma.riskEvent.create({
      data: {
        type: 'STOCK_LOW',
        level: 'WARNING',
        description: '丙酮库存不足，当前库存2瓶，最低库存5瓶',
        reagentId: reagents[1].id,
        isResolved: false,
      },
    }),
    // 临期预警
    prisma.riskEvent.create({
      data: {
        type: 'EXPIRING',
        level: 'WARNING',
        description: '甲苯将于15天后过期，请及时处理',
        reagentId: reagents[2].id,
        isResolved: false,
      },
    }),
    // 已过期
    prisma.riskEvent.create({
      data: {
        type: 'EXPIRED',
        level: 'CRITICAL',
        description: '乙酸乙酯已过期30天，请立即处置',
        reagentId: reagents[3].id,
        isResolved: false,
      },
    }),
    // 低库存 - 氢氧化钠（已解决）
    prisma.riskEvent.create({
      data: {
        type: 'STOCK_LOW',
        level: 'INFO',
        description: '氢氧化钠库存不足，当前库存1瓶，最低库存3瓶',
        reagentId: reagents[5].id,
        isResolved: true,
        resolvedAt: daysFromNow(-2),
        resolvedById: admin3.id,
      },
    }),
    // 设备异常
    prisma.riskEvent.create({
      data: {
        type: 'DEVICE_ABNORMAL',
        level: 'WARNING',
        description: '通风橱排风量不足，已报修',
        deviceId: devices[2].id,
        isResolved: false,
      },
    }),
  ]);

  // ─── 创建试剂台账记录 ───
  await Promise.all([
    prisma.reagentLog.create({
      data: {
        reagentId: reagents[0].id,
        action: 'STOCK_IN',
        quantity: 10,
        operatorId: admin3.id,
        note: '新采购入库',
        createdAt: daysFromNow(-10),
      },
    }),
    prisma.reagentLog.create({
      data: {
        reagentId: reagents[0].id,
        action: 'STOCK_OUT',
        quantity: 5,
        operatorId: member.id,
        note: '赵实验领用5瓶浓硫酸',
        createdAt: daysFromNow(-7),
      },
    }),
    prisma.reagentLog.create({
      data: {
        reagentId: reagents[4].id,
        action: 'STOCK_IN',
        quantity: 20,
        operatorId: admin3.id,
        note: '常规补货',
        createdAt: daysFromNow(-5),
      },
    }),
    prisma.reagentLog.create({
      data: {
        reagentId: reagents[5].id,
        action: 'STOCK_OUT',
        quantity: 4,
        operatorId: member.id,
        note: '赵实验领用4瓶氢氧化钠',
        createdAt: daysFromNow(-3),
      },
    }),
    prisma.reagentLog.create({
      data: {
        reagentId: reagents[1].id,
        action: 'ADJUST',
        quantity: -1,
        operatorId: admin3.id,
        note: '盘点调整，实际比账面少1瓶',
        createdAt: daysFromNow(-1),
      },
    }),
  ]);

  console.log('✅ 种子数据创建完成');
  console.log(`  实验室: ${lab.name}`);
  console.log(`  用户: ${[admin, admin2, admin3, member].map((u) => `${u.name}(${u.role})`).join(', ')}`);
  console.log(`  试剂: ${reagents.length}条`);
  console.log(`  设备: ${devices.length}条`);
  console.log('  默认密码: 123456（所有用户）');
}

main()
  .catch((e) => {
    console.error('❌ 种子数据创建失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
