import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { renderServerSmilesSvg } from '@/lib/rdkit-server';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!isUserContext(auth)) return auth;
  const smiles = request.nextUrl.searchParams.get('smiles')?.trim();
  if (!smiles || smiles.length > 2000) return NextResponse.json({ error: 'SMILES 为空或过长' }, { status: 400 });
  if (!checkRateLimit(`${auth.userId}:structure`, { capacity: 30, refillPerSec: 1 }).allowed) return new NextResponse(null, { status: 429 });
  try {
    const svg = await renderServerSmilesSvg(smiles);
    if (!svg) return NextResponse.json({ error: '无法解析该分子结构' }, { status: 422 });
    return new NextResponse(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  } catch {
    return NextResponse.json({ error: '结构渲染暂时不可用，请稍后重试或复制 SMILES' }, { status: 503 });
  }
}
