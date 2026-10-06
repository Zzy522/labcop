import { NextRequest, NextResponse } from 'next/server';
import { parsePagination, paginatedResponse, withErrorHandler, validationError } from '@/lib/api-utils';
import { createCompoundSchema } from '@/lib/validations/compound';
import { compoundService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

/**
 * GET /api/compounds
 * 列出当前实验室的化合物（按 labId 隔离）
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const { page, pageSize } = parsePagination(searchParams);

  const result = await compoundService.listCompounds({
    labId: ctx.labId,
    search: searchParams.get('search') || undefined,
    status: searchParams.get('status') || undefined,
    source: searchParams.get('source') || undefined,
    casNumber: searchParams.get('casNumber') || undefined,
    page,
    pageSize,
  });

  return NextResponse.json(paginatedResponse(result.data, result.total, result.page, result.pageSize));
});

/**
 * POST /api/compounds
 * 创建化合物（任何登录用户均可创建，但仅限本实验室）
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;
  if (!ctx.labId) {
    return NextResponse.json({ error: '当前用户未关联实验室，无法创建化合物' }, { status: 400 });
  }

  const body = await request.json();
  const parsed = createCompoundSchema.safeParse(body);
  if (!parsed.success) {
    return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }

  const compound = await compoundService.createCompound(parsed.data, ctx.labId, ctx.userId);
  return NextResponse.json(compound, { status: 201 });
});
