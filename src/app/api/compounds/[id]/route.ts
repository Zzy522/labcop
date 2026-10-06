import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { updateCompoundSchema } from '@/lib/validations/compound';
import { compoundService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

/**
 * GET /api/compounds/[id]
 * 获取化合物详情（含批次/测试/使用记录/文档）
 */
export const GET = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;
  const compound = await compoundService.getCompoundDetail(id, ctx.labId);
  return NextResponse.json(compound);
});

/**
 * PATCH /api/compounds/[id]
 */
export const PATCH = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = updateCompoundSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }

  const compound = await compoundService.updateCompound(id, ctx.labId, parsed.data, ctx.userId);
  return NextResponse.json(compound);
});

/**
 * DELETE /api/compounds/[id]
 */
export const DELETE = withErrorHandler(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;
  const result = await compoundService.deleteCompound(id, ctx.labId, ctx.userId);
  return NextResponse.json(result);
});
