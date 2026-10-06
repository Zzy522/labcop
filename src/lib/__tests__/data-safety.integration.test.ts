import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth-middleware', () => ({
  requireAuth: async () => ({ userId: 'user-a', labId: 'lab-a', isAdmin: true }),
  requireAdmin: async () => ({ userId: 'user-a', labId: 'lab-a', isAdmin: true }),
  isUserContext: () => true,
}));
vi.mock('@/lib/prisma', async () => {
  const { PrismaClient } = await import('@/generated/prisma/client');
  const { PrismaLibSql } = await import('@prisma/adapter-libsql');
  const directory = await mkdtemp(path.join(tmpdir(), 'lab-safety-'));
  const url = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  return { prisma: new PrismaClient({ adapter: new PrismaLibSql({ url }) }), testDirectory: directory, testUrl: url };
});

import { prisma } from '@/lib/prisma';
import { createRequisition, reviewRequisitionAction } from '@/lib/services/requisition.service';
import { resolveRiskEvent } from '@/lib/services/alert.service';
import { archiveReagent, updateReagent } from '@/lib/services/reagent.service';
import { upsertEntities } from '@/lib/memory/service';
import { idempotentTransaction } from '@/lib/idempotency';
import { requestLabDeletion, finalizeLabDeletion } from '@/lib/lab-lifecycle-service';
import { POST as manualStockIn } from '@/app/api/stock-ins/manual/route';
import { POST as adjustInventory } from '@/app/api/reagents/[id]/adjust/route';
import { retireMember } from '@/lib/member-retirement';

let directory: string;
beforeAll(async () => {
  const fixture = await import('@/lib/prisma') as unknown as { testDirectory: string; testUrl: string };
  directory = fixture.testDirectory;
  const client = createClient({ url: fixture.testUrl });
  for (const folder of (await readdir('prisma/migrations')).sort()) {
    if (!/^\d/.test(folder)) continue;
    await client.executeMultiple(await readFile(`prisma/migrations/${folder}/migration.sql`, 'utf8'));
  }
  client.close();
  await prisma.lab.createMany({ data: [{ id: 'lab-a', name: 'A', location: 'A' }, { id: 'lab-b', name: 'B', location: 'B' }] });
  await prisma.user.createMany({ data: [
    { id: 'user-a', name: 'A', email: 'a@test.local', password: 'test', role: 'ADMIN', labId: 'lab-a' },
    { id: 'user-b', name: 'B', email: 'b@test.local', password: 'test', role: 'ADMIN', labId: 'lab-b' },
  ] });
  await prisma.labMembership.createMany({ data: [{ userId: 'user-a', labId: 'lab-a', role: 'LAB_ADMIN' }, { userId: 'user-b', labId: 'lab-b', role: 'LAB_ADMIN' }] });
  await prisma.reagent.createMany({ data: [
    { id: 'reagent-a', name: 'A', labId: 'lab-a', stockQuantity: 10, unit: '瓶', specification: '500mL', capacityPerUnit: 500, capacityUnit: 'mL' },
    { id: 'reagent-b', name: 'B', labId: 'lab-b', stockQuantity: 10, unit: '瓶' },
  ] });
}, 30_000);
afterAll(async () => { await prisma.$disconnect(); if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(error => { if (process.platform !== 'win32' || error.code !== 'EBUSY') throw error; }); });

const input = { reagentId: 'reagent-a', applicantId: 'user-a', labId: 'lab-a', quantity: 1, requestedQuantity: 1, requestedUnit: '瓶', mode: 'CHECKOUT' as const, requestKey: 'request-000000001' };

describe('真实隔离 SQLite：租户、流水、幂等与恢复', () => {
  it('删除登录身份保留原作者和文档，释放邮箱且不继承旧身份', async () => {
    const lab = await prisma.lab.create({ data: { name: 'retirement', location: 'test' } });
    const admin = await prisma.user.create({ data: { name: 'admin', email: 'retire-admin@test.local', password: 'test' } });
    const member = await prisma.user.create({ data: { name: 'member', email: 'retire-member@test.local', password: 'test', labId: lab.id } });
    await prisma.labMembership.createMany({ data: [{ userId: admin.id, labId: lab.id, role: 'LAB_ADMIN' }, { userId: member.id, labId: lab.id, role: 'LAB_MEMBER' }] });
    const doc = await prisma.document.create({ data: { uploadedById: member.id, labId: lab.id, type: 'OTHER', fileUrl: 'data/test-preserved.txt' } });
    const project = await prisma.researchProject.create({ data: { labId: lab.id, name: 'preserved', createdById: member.id } });
    const projectDoc = await prisma.projectDocument.create({ data: { projectId: project.id, title: '原始文档', createdById: member.id } });
    const version = await prisma.projectDocumentVersion.create({ data: { documentId: projectDoc.id, version: 1, fileUrl: 'data/projects/preserved.docx', fileName: '原始文档.docx', uploadedById: member.id } });
    const session = await prisma.chatSession.create({ data: { userId: member.id, labId: lab.id, title: '历史会话' } });
    await prisma.authSession.create({ data: { userId: member.id, tokenHash: 'retirement-session', expiresAt: new Date(Date.now() + 100000) } });
    await retireMember(admin.id, member.id, '离组', lab.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).status).toBe('RETIRED');
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).uploadedById).toBe(member.id);
    expect((await prisma.projectDocumentVersion.findUniqueOrThrow({ where: { id: version.id } })).uploadedById).toBe(member.id);
    expect((await prisma.chatSession.findUniqueOrThrow({ where: { id: session.id } })).userId).toBe(member.id);
    expect((await prisma.authSession.findUniqueOrThrow({ where: { tokenHash: 'retirement-session' } })).revokedAt).not.toBeNull();
    const fresh = await prisma.user.create({ data: { name: 'new', email: 'retire-member@test.local', password: 'new' } });
    expect(fresh.id).not.toBe(member.id);
    expect(await prisma.labMembership.count({ where: { userId: fresh.id } })).toBe(0);
    expect(await prisma.platformAuditLog.count({ where: { targetId: member.id, action: 'RETIRE_MEMBER' } })).toBe(1);
  });
  it('实验室删除拒绝跨组织、自己和负责人，平台管理员可注销普通跨组织账号', async () => {
    const lab = await prisma.lab.create({ data: { name: 'multi', location: 'test' } });
    const owner = await prisma.user.create({ data: { name: 'owner', email: 'retire-owner@test.local', password: 'test' } });
    const target = await prisma.user.create({ data: { name: 'multi', email: 'retire-multi@test.local', password: 'test' } });
    const platform = await prisma.user.create({ data: { name: 'platform', email: 'retire-platform@test.local', password: 'test', platformRole: 'PLATFORM_ADMIN' } });
    await prisma.labMembership.createMany({ data: [{ labId: lab.id, userId: owner.id, role: 'LAB_OWNER' }, { labId: lab.id, userId: target.id }, { labId: 'lab-b', userId: target.id }] });
    await expect(retireMember(owner.id, owner.id, 'test', lab.id)).rejects.toThrow('当前登录');
    await expect(retireMember(owner.id, target.id, 'test', lab.id)).rejects.toThrow('其他组织');
    await expect(retireMember(platform.id, owner.id, 'test')).rejects.toThrow('交接');
    await expect(retireMember(owner.id, platform.id, 'test')).rejects.toThrow('权限');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe('ACTIVE');
    await retireMember(platform.id, target.id, '平台处理');
    expect(await prisma.labMembership.count({ where: { userId: target.id, status: 'ACTIVE' } })).toBe(0);
  });
  it('跨租户领用不创建申请或扣减库存', async () => {
    await expect(createRequisition({ ...input, reagentId: 'reagent-b' })).rejects.toThrow('试剂');
    expect((await prisma.reagent.findUniqueOrThrow({ where: { id: 'reagent-b' } })).stockQuantity).toBe(10);
    expect(await prisma.requisition.count()).toBe(0);
  });
  it('跨租户审批和风险处理不会变更目标状态', async () => {
    const request = await prisma.requisition.create({ data: { reagentId: 'reagent-b', applicantId: 'user-b', labId: 'lab-b', quantity: 1, status: 'PENDING' } });
    await expect(reviewRequisitionAction(request.id, { action: 'APPROVED' }, 'user-a', 'lab-a')).rejects.toThrow();
    const event = await prisma.riskEvent.create({ data: { labId: 'lab-b', type: 'OTHER', level: 'WARNING', description: 'B' } });
    await expect(resolveRiskEvent(event.id, 'user-a', 'lab-a')).rejects.toThrow();
    expect((await prisma.requisition.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('PENDING');
    expect((await prisma.riskEvent.findUniqueOrThrow({ where: { id: event.id } })).isResolved).toBe(false);
  });
  it('重复领用返回原申请，不重复扣减；同键不同内容拒绝', async () => {
    const first = await createRequisition(input);
    const second = await createRequisition(input);
    expect(second.id).toBe(first.id);
    expect((await prisma.reagent.findUniqueOrThrow({ where: { id: 'reagent-a' } })).stockQuantity).toBe(9);
    expect(await prisma.reagentLog.count({ where: { reagentId: 'reagent-a' } })).toBe(1);
    await expect(createRequisition({ ...input, requestedQuantity: 2 })).rejects.toThrow('其他内容');
  });
  it('旧版本编辑被拒绝，归档保留台账并可以恢复', async () => {
    await expect(updateReagent('reagent-a', { version: 0, name: 'stale' }, 'lab-a', 'user-a')).rejects.toThrow('更新');
    await archiveReagent('reagent-a', 'lab-a', 'user-a', true);
    expect(await prisma.reagentLog.count({ where: { reagentId: 'reagent-a' } })).toBe(1);
    await expect(createRequisition({ ...input, requestKey: 'request-000000002' })).rejects.toThrow('试剂');
    await archiveReagent('reagent-a', 'lab-a', 'user-a', false);
    expect((await prisma.reagent.findUniqueOrThrow({ where: { id: 'reagent-a' } })).archivedAt).toBeNull();
  });
  it('同一用户两个实验室的同名实体独立存储', async () => {
    await upsertEntities('user-a', 'lab-a', [{ entityType: 'COMPOUND', name: 'XY-1', attributes: { origin: 'A' } }]);
    await upsertEntities('user-a', 'lab-b', [{ entityType: 'COMPOUND', name: 'XY-1', attributes: { origin: 'B' } }]);
    expect(await prisma.entityMemory.count({ where: { userId: 'user-a', name: 'XY-1' } })).toBe(2);
  });
  it('事务失败回滚幂等记录与业务写入，允许原键重试', async () => {
    const scope = { labId: 'lab-a', userId: 'user-a', operation: 'TEST', key: 'rollback-test-key', digest: 'same' };
    await expect(idempotentTransaction(scope, async tx => {
      await tx.reagent.update({ where: { id: 'reagent-a' }, data: { stockQuantity: 0 } });
      throw new Error('simulated crash');
    })).rejects.toThrow('simulated crash');
    expect((await prisma.reagent.findUniqueOrThrow({ where: { id: 'reagent-a' } })).stockQuantity).toBe(9);
    expect(await idempotentTransaction(scope, async () => ({ ok: true }))).toEqual({ ok: true });
  });
  it('并发重放后用原键重试，最终只产生一笔扣减', async () => {
    const repeated = { ...input, requestKey: 'parallel-request-001' };
    await Promise.allSettled(Array.from({ length: 5 }, () => createRequisition(repeated)));
    const replay = await createRequisition(repeated);
    expect(replay.status).toBe('APPROVED');
    expect((await prisma.reagent.findUniqueOrThrow({ where: { id: 'reagent-a' } })).stockQuantity).toBe(8);
    expect(await prisma.reagentLog.count({ where: { reagentId: 'reagent-a' } })).toBe(2);
  });
  it('审计约束失败会回滚关键变更', async () => {
    await expect(archiveReagent('reagent-a', 'lab-a', 'nonexistent-user', true)).rejects.toThrow();
    expect((await prisma.reagent.findUniqueOrThrow({ where: { id: 'reagent-a' } })).archivedAt).toBeNull();
  });
  it('实验室到期操作只归档，不清除库存和成员', async () => {
    await requestLabDeletion('lab-b', 'user-a');
    await finalizeLabDeletion('lab-b', 'user-a', { immediate: true });
    expect((await prisma.lab.findUniqueOrThrow({ where: { id: 'lab-b' } })).status).toBe('DELETED');
    expect(await prisma.reagent.count({ where: { labId: 'lab-b' } })).toBe(1);
    expect(await prisma.labMembership.count({ where: { labId: 'lab-b', status: 'ACTIVE' } })).toBe(1);
  });
  it('手工入库 API 重放只生成一条试剂和初始流水', async () => {
    const request = () => {
      const body = new FormData();
      body.set('reagent', JSON.stringify({ name: 'manual', specification: '500mL', storageLocation: 'A', stockQuantity: 3, unit: '瓶', labId: 'lab-b' }));
      body.set('noReceipt', 'true');
      body.set('noReceiptReason', '测试内部转入');
      return new NextRequest('http://localhost/api/stock-ins/manual', { method: 'POST', headers: { 'Idempotency-Key': 'manual-request-0001' }, body });
    };
    const first = await manualStockIn(request());
    const second = await manualStockIn(request());
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const record = await first.json();
    expect((await second.json()).reagent.id).toBe(record.reagent.id);
    expect(record.reagent.labId).toBe('lab-a');
    expect(await prisma.reagentLog.count({ where: { reagentId: record.reagent.id } })).toBe(1);
  });
  it('盘点 API 同事务保存差额与审计，重放不重复记账', async () => {
    const reagent = await prisma.reagent.findFirstOrThrow({ where: { name: 'manual' } });
    const request = () => new NextRequest(`http://localhost/api/reagents/${reagent.id}/adjust`, { method: 'POST', headers: { 'Idempotency-Key': 'adjust-request-0001', 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity: 2.5, version: reagent.version, reason: '盘点发现损耗' }) });
    const first = await adjustInventory(request(), { params: Promise.resolve({ id: reagent.id }) });
    expect(first.status).toBe(200);
    const replay = await adjustInventory(request(), { params: Promise.resolve({ id: reagent.id }) });
    expect(replay.status).toBe(200);
    expect((await prisma.reagent.findUniqueOrThrow({ where: { id: reagent.id } })).stockQuantity).toBe(2.5);
    const logs = await prisma.reagentLog.findMany({ where: { reagentId: reagent.id } });
    expect(logs.reduce((sum, log) => sum + (log.action === 'STOCK_IN' ? log.quantity : -log.quantity), 0)).toBe(2.5);
    expect(await prisma.auditLog.count({ where: { targetId: reagent.id } })).toBe(1);
  });
});
