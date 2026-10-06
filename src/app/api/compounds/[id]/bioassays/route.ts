import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { createBioAssaySchema } from '@/lib/validations/compound';
import { compoundService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

/**
 * POST /api/compounds/[id]/bioassays
 * 为指定化合物添加生物活性测试记录
 */
export const POST = withErrorHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const ctx = await requireAuth(request);
    if (!isUserContext(ctx)) return ctx;
    if (!ctx.labId) {
      return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = createBioAssaySchema.safeParse({ ...body, compoundId: id });
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const assay = await compoundService.createBioAssay(parsed.data, ctx.labId, ctx.userId);
    return NextResponse.json(assay, { status: 201 });
  }
);
