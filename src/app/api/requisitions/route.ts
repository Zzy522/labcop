import { requireIdempotencyKey } from '@/lib/idempotency';
import { NextRequest, NextResponse } from 'next/server';
import { parsePagination, paginatedResponse, withErrorHandler } from '@/lib/api-utils';
import { createRequisitionSchema } from '@/lib/validations/requisition';
import { requisitionService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { checkReagentQualifications, formatQualificationError } from '@/lib/services/qualification.service';

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const { page, pageSize } = parsePagination(searchParams);

  // 认证：必须登录
  const ctx = await requireAuth(request);
  if (!isUserContext(ctx)) return ctx;

  // 数据隔离：必须有 labId
  if (!ctx.labId) {
    return NextResponse.json({ error: '未关联实验室，无法查询领用申请' }, { status: 403 });
  }

  // 实验员只能查看自己的申请；管理员可查看本实验室所有申请
  const applicantId = searchParams.get('applicantId') || undefined;
  const effectiveApplicantId = !ctx.isAdmin && applicantId !== ctx.userId ? ctx.userId : applicantId;

  const result = await requisitionService.listRequisitions({
    status: searchParams.get('status') || undefined,
    applicantId: effectiveApplicantId,
    labId: ctx.labId,
    page,
    pageSize,
  });

  return NextResponse.json(paginatedResponse(result.data, result.total, result.page, result.pageSize));
});

export const POST = withErrorHandler(async (request: NextRequest) => {
  // 认证：必须登录
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 数据隔离：必须有 labId
  if (!authResult.labId) {
    return NextResponse.json({ error: '当前用户未关联实验室，无法创建领用申请' }, { status: 400 });
  }

  const requestKey = requireIdempotencyKey(request);
  const body = await request.json();
  const parsed = createRequisitionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '输入校验失败', details: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  // 资质校验：用户必须持有试剂要求的所有有效资质
  const qualCheck = await checkReagentQualifications(authResult.userId, parsed.data.reagentId);
  if (!qualCheck.passed) {
    return NextResponse.json(
      { error: `资质校验未通过：${formatQualificationError(qualCheck)}` },
      { status: 403 }
    );
  }

  // 安全修复：不从请求体读取 applicantId，强制使用认证用户的 userId
  // 同时传入 labId 用于数据隔离
  const result = await requisitionService.createRequisition({
    ...parsed.data,
    applicantId: authResult.userId,
    labId: authResult.labId,
    requestKey,
  });
  return NextResponse.json(result, { status: 201 });
});
