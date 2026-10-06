import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler, validationError } from '@/lib/api-utils';
import { createCompoundDocumentSchema } from '@/lib/validations/compound';
import { compoundService } from '@/lib/services';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';

/**
 * POST /api/compounds/[id]/documents
 * 为指定化合物上传文档元数据（文件本身通过通用上传接口获取 URL）
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
    const parsed = createCompoundDocumentSchema.safeParse({ ...body, compoundId: id });
    if (!parsed.success) {
      return validationError(parsed.error.flatten().fieldErrors as Record<string, string[]>);
    }

    const doc = await compoundService.createDocument(parsed.data, ctx.labId, ctx.userId);
    return NextResponse.json(doc, { status: 201 });
  }
);
