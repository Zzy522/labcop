import { NextRequest, NextResponse } from 'next/server';
import { withErrorHandler } from '@/lib/api-utils';
import { requireAuth, isUserContext } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/services/audit.service';
import { checkRateLimit, RATE_LIMIT_PRESETS } from '@/lib/rate-limit';

/**
 * GET /api/pubchem/lookup?cas=xxx
 * 根据 CAS 号查询 PubChem，返回分子式、分子量、IUPAC名称、SMILES、结构式URL
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 速率限制（per-user，PubChem 限 5 req/s）
  const rl = checkRateLimit(`${authResult.userId}:pubchem`, RATE_LIMIT_PRESETS.pubchem);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `查询过于频繁，请 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后再试`, category: 'QUOTA_EXCEEDED' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const cas = searchParams.get('cas')?.trim();

  if (!cas) {
    return NextResponse.json({ error: 'CAS号不能为空' }, { status: 400 });
  }

  const baseUrl = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
  const propsUrl = `${baseUrl}/${encodeURIComponent(cas)}/property/MolecularFormula,MolecularWeight,IUPACName,Title,CanonicalSMILES,IsomericSMILES,ConnectivitySMILES/JSON`;

  const propsRes = await fetch(propsUrl, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!propsRes.ok) {
    if (propsRes.status === 404) {
      return NextResponse.json(
        { error: `PubChem 未找到 CAS 号「${cas}」对应的化合物，请确认 CAS 号是否正确` },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: `PubChem 查询失败（HTTP ${propsRes.status}）` },
      { status: 502 }
    );
  }

  const propsData = await propsRes.json();
  const compound = propsData?.PropertyTable?.Properties?.[0];

  if (!compound) {
    return NextResponse.json({ error: 'PubChem 返回数据格式异常' }, { status: 502 });
  }

  const structureImgUrl = `${baseUrl}/${encodeURIComponent(cas)}/PNG`;
  const smiles = compound.IsomericSMILES || compound.CanonicalSMILES || compound.ConnectivitySMILES || null;

  return NextResponse.json({
    data: {
      cas,
      cid: compound.CID,
      molecularFormula: compound.MolecularFormula || null,
      molecularWeight: compound.MolecularWeight ? String(compound.MolecularWeight) : null,
      iupacName: compound.IUPACName || null,
      title: compound.Title || null,
      smiles,
      canonicalSmiles: compound.CanonicalSMILES || compound.ConnectivitySMILES || null,
      isomericSmiles: compound.IsomericSMILES || null,
      structureImgUrl,
    },
  });
});

/**
 * POST /api/pubchem/lookup?reagentId=xxx
 * 根据 CAS 号查询 PubChem 并自动更新试剂字段（含 SMILES）
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;

  // 速率限制（per-user，PubChem 限 5 req/s）
  const rl = checkRateLimit(`${authResult.userId}:pubchem`, RATE_LIMIT_PRESETS.pubchem);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `查询过于频繁，请 ${Math.ceil(rl.retryAfterMs / 1000)} 秒后再试`, category: 'QUOTA_EXCEEDED' },
      { status: 429 }
    );
  }

  const { searchParams } = new URL(request.url);
  const reagentId = searchParams.get('reagentId');

  if (!reagentId) {
    return NextResponse.json({ error: '缺少 reagentId 参数' }, { status: 400 });
  }

  if (!authResult.labId) {
    return NextResponse.json({ error: '未关联实验室' }, { status: 403 });
  }

  // IDOR 修复：按 id + labId 查询，防跨实验室越权读取/更新他人试剂
  const reagent = await prisma.reagent.findFirst({
    where: { id: reagentId, labId: authResult.labId },
    select: { id: true, name: true, casNumber: true },
  });

  if (!reagent) {
    return NextResponse.json({ error: '试剂不存在' }, { status: 404 });
  }

  if (!reagent.casNumber) {
    return NextResponse.json({ error: '该试剂未填写 CAS 号，无法自动导入' }, { status: 400 });
  }

  const baseUrl = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
  const propsUrl = `${baseUrl}/${encodeURIComponent(reagent.casNumber)}/property/MolecularFormula,MolecularWeight,IUPACName,Title,CanonicalSMILES,IsomericSMILES,ConnectivitySMILES/JSON`;

  const propsRes = await fetch(propsUrl, {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  if (!propsRes.ok) {
    if (propsRes.status === 404) {
      return NextResponse.json(
        { error: `PubChem 未找到 CAS 号「${reagent.casNumber}」对应的化合物` },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: `PubChem 查询失败（HTTP ${propsRes.status}）` },
      { status: 502 }
    );
  }

  const propsData = await propsRes.json();
  const compound = propsData?.PropertyTable?.Properties?.[0];

  if (!compound) {
    return NextResponse.json({ error: 'PubChem 返回数据格式异常' }, { status: 502 });
  }

  const structureImgUrl = `${baseUrl}/${encodeURIComponent(reagent.casNumber)}/PNG`;
  const smiles = compound.IsomericSMILES || compound.CanonicalSMILES || compound.ConnectivitySMILES || null;

  const updated = await prisma.reagent.update({
    where: { id: reagentId },
    data: {
      molecularFormula: compound.MolecularFormula || null,
      molecularWeight: compound.MolecularWeight ? String(compound.MolecularWeight) : null,
      iupacName: compound.IUPACName || null,
      smiles,
      structureImgUrl,
    },
  });

  await logAudit({
    operatorId: authResult.userId,
    action: 'UPDATE',
    targetType: 'REAGENT',
    targetId: reagentId,
    targetName: reagent.name,
    afterData: {
      molecularFormula: updated.molecularFormula,
      molecularWeight: updated.molecularWeight,
      iupacName: updated.iupacName,
      smiles: updated.smiles,
      structureImgUrl: updated.structureImgUrl,
    },
    note: `通过 CAS 号「${reagent.casNumber}」从 PubChem 自动导入试剂信息（含 SMILES）`,
  });

  return NextResponse.json({
    data: {
      molecularFormula: updated.molecularFormula,
      molecularWeight: updated.molecularWeight,
      iupacName: updated.iupacName,
      smiles: updated.smiles,
      structureImgUrl: updated.structureImgUrl,
    },
    message: '已从 PubChem 导入试剂信息（含 SMILES）',
  });
});
