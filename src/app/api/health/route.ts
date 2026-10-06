import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mkdir, writeFile, unlink, statfs } from 'node:fs/promises';
import path from 'node:path';

// 健康检查端点无需认证，且必须每次实时探测（不缓存）
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * 探测数据库连通性，供 Nginx / 监控系统 / 容器编排探活。
 * 不暴露内部细节，仅返回 ok / degraded。
 */
export async function GET() {
  const start = Date.now();
  try {
    // 最轻量探测
    await prisma.businessOperation.count();
    await Promise.all([
      prisma.assistantRun.findFirst({ select: { id: true, captureContent: true, expiresAt: true } }),
      prisma.assistantDiagnosticPolicy.findFirst({ select: { labId: true } }),
      prisma.assistantDiagnosticGrant.findFirst({ select: { userId: true } }),
      prisma.assistantSpan.findFirst({ select: { id: true } }),
      prisma.assistantCase.findFirst({ select: { id: true } }),
      prisma.assistantEvaluation.findFirst({ select: { id: true } }),
    ]);
    await prisma.reagent.findFirst({ select: { version: true, archivedAt: true } });
    const directory = path.join(process.cwd(), 'data', 'health');
    await mkdir(directory, { recursive: true });
    const disk = await statfs(directory);
    if (disk.bavail * disk.bsize < 100 * 1024 * 1024) throw new Error('Insufficient storage');
    const probe = path.join(directory, crypto.randomUUID());
    try { await writeFile(probe, 'probe', { flag: 'wx' }); }
    finally { await unlink(probe).catch(() => undefined); }
    return NextResponse.json(
      {
        status: 'ok',
        db: 'ok',
        time: Date.now() - start,
        ts: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        status: 'degraded',
        db: 'error',
        time: Date.now() - start,
        ts: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
