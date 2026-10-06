import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { createSynthesisBatchSchema } from '@/lib/validations/compound';
import { compoundService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

/**
 * POST /api/compounds/[id]/batches
 * 为指定化合物添加合成批次
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
    const parsed = createSynthesisBatchSchema.safeParse({ ...body, compoundId: id });
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const batch = await compoundService.createSynthesisBatch(parsed.data, ctx.labId, ctx.userId);
    return NextResponse.json(batch, { status: 201 });
  }
);
