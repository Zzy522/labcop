import { withErrorHandler } from '@/lib/api-utils';
import { NextRequest, NextResponse } from 'next/server';
import { updateReagentSchema } from '@/lib/validations/reagent';
import { reagentService } from '@/lib/services';
import { requireAuth, requireAdmin, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * 校验试剂是否属于当前用户的实验室
 */
async function checkReagentOwnership(reagentId: string, labId?: string): Promise<boolean> {
  if (!labId) return false;
  const reagent = await prisma.reagent.findUnique({
    where: { id: reagentId },
    select: { labId: true },
  });
  return !!reagent && reagent.labId === labId;
}

export const GET = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;

  // IDOR 修复：校验试剂归属
  const owned = await checkReagentOwnership(id, authResult.labId);
  if (!owned) {
    return NextResponse.json({ error: '试剂不存在或无权访问' }, { status: 404 });
  }

  const reagent = await reagentService.getReagent(id);
  return NextResponse.json(reagent);
});

export const PUT = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;

  // IDOR 修复：校验试剂归属
  const owned = await checkReagentOwnership(id, authResult.labId);
  if (!owned) {
    return NextResponse.json({ error: '试剂不存在或无权访问' }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateReagentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '输入校验失败', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const reagent = await reagentService.updateReagent(id, parsed.data, authResult.labId, authResult.userId);
  return NextResponse.json(reagent);
});

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireAdmin(request);
  if (!isUserContext(authResult)) return authResult;

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;

  // IDOR 修复：校验试剂归属
  const owned = await checkReagentOwnership(id, authResult.labId);
  if (!owned) {
    return NextResponse.json({ error: '试剂不存在或无权访问' }, { status: 404 });
  }

  try {
    await reagentService.archiveReagent(id, authResult.labId, authResult.userId, true);
    return NextResponse.json({ message: '已归档，库存和历史记录保留，可恢复' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '删除失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const PATCH = withErrorHandler(async (request: NextRequest, { params }: RouteParams) => {
  const auth = await requireAdmin(request);
  if (!isUserContext(auth)) return auth;
  if (!auth.labId) return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  const { id } = await params;
  if (!(await checkReagentOwnership(id, auth.labId))) return NextResponse.json({ error: '试剂不存在' }, { status: 404 });
  const body = await request.json();
  if (body.action !== 'RESTORE') return NextResponse.json({ error: '仅支持恢复归档' }, { status: 400 });
  const data = await reagentService.archiveReagent(id, auth.labId, auth.userId, false);
  return NextResponse.json({ data, message: '已恢复' });
});
