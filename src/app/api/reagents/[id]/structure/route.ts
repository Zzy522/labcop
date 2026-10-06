import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { renderStructureImage } from '@/lib/structure-image-server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

const CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=3600, stale-while-revalidate=86400',
  'X-Content-Type-Options': 'nosniff',
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  const { id } = await params;
  const reagent = await prisma.reagent.findFirst({
    where: { id, labId: authResult.labId },
    select: { smiles: true, casNumber: true, structureImgUrl: true },
  });
  if (!reagent) {
    return NextResponse.json({ error: '试剂不存在或无权访问' }, { status: 404 });
  }

  const image = await renderStructureImage({
    smiles: reagent.smiles,
    casNumber: reagent.casNumber,
    storedPubChemUrl: reagent.structureImgUrl,
  });
  if (image) {
    return new Response(image.body, {
      headers: {
        ...CACHE_HEADERS,
        'Content-Type': image.contentType,
        'X-Structure-Source': image.source,
      },
    });
  }

  return NextResponse.json(
    { error: '暂无可用结构图，请先补充有效的 SMILES 或 CAS 号' },
    { status: 404 }
  );
}
