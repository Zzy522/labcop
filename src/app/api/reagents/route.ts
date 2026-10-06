import { NextRequest, NextResponse } from 'next/server';
import { parsePagination, paginatedResponse, withErrorHandler } from '@/lib/api-utils';
import { createReagentSchema } from '@/lib/validations/reagent';
import { reagentService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { page, pageSize } = parsePagination(searchParams);

  // 认证：必须登录
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;

  // 权限隔离：所有角色只能查看本实验室试剂（admin 不例外，跨实验室隔离）
  if (!ctx.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }
  const labId = ctx.labId;

  const result = await reagentService.listReagents({
    archived: ctx.isAdmin && searchParams.get('archived') === 'true',
    search: searchParams.get('search') || undefined,
    riskLevel: searchParams.get('riskLevel') || undefined,
    isHazardous: searchParams.get('isHazardous') === 'true' ? true : searchParams.get('isHazardous') === 'false' ? false : undefined,
    isControlled: searchParams.get('isControlled') === 'true' ? true : searchParams.get('isControlled') === 'false' ? false : undefined,
    storageLocation: searchParams.get('storageLocation') || undefined,
    // SMILES 子结构/精准查找
    smilesSearch: searchParams.get('smilesSearch') || undefined,
    smilesMode: (searchParams.get('smilesMode') as 'exact' | 'substructure') || undefined,
    labId,
    page,
    pageSize,
  });

  // 实验员可查看本实验室试剂的完整信息（含库存量、位置），便于查询
  return NextResponse.json(paginatedResponse(result.data, result.total, result.page, result.pageSize));
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  // 认证：允许任何登录用户（含实验员）创建试剂
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 实验员只能为自己所在实验室创建试剂
  if (!authResult.labId) {
    return NextResponse.json({ error: '当前用户未关联实验室，无法创建试剂' }, { status: 400 });
  }

  const body = await request.json();
  const parsed = createReagentSchema.safeParse({ ...body, labId: authResult.labId });
  if (!parsed.success) {
    return NextResponse.json({ error: '请完善试剂信息：' + [...new Set(parsed.error.issues.map(issue => issue.message))].join('；'), details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // 安全修复：强制使用认证用户的 labId，忽略请求体中的 labId
  const reagent = await reagentService.createReagent(
    { ...parsed.data, labId: authResult.labId },
    authResult.userId,
  );
  return NextResponse.json(reagent, { status: 201 });
});
