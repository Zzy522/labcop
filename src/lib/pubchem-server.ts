import { fetchUpstream } from '@/lib/upstream-fetch';

export interface PubChemCompoundInfo {
  cas: string;
  cid: number | null;
  molecularFormula: string | null;
  molecularWeight: string | null;
  iupacName: string | null;
  title: string | null;
  smiles: string | null;
  canonicalSmiles: string | null;
  isomericSmiles: string | null;
  structureImgUrl: string;
}

export interface PubChemReagentFields {
  molecularFormula: string;
  molecularWeight: string;
  iupacName: string;
  smiles: string;
  structureImgUrl: string;
  missingLabels: string[];
}

/** PubChem 返回缺项时保留空字符串，不回退到未经验证的 OCR/LLM 内容。 */
export function getPubChemReagentFields(info: PubChemCompoundInfo | null): PubChemReagentFields {
  const fields = {
    molecularFormula: info?.molecularFormula || '',
    molecularWeight: info?.molecularWeight || '',
    iupacName: info?.iupacName || '',
    smiles: info?.smiles || '',
    structureImgUrl: info?.structureImgUrl || '',
  };
  const missingLabels = [
    !fields.molecularFormula && '分子式',
    !fields.molecularWeight && '分子量',
    !fields.iupacName && 'IUPAC 名称',
    !fields.smiles && 'SMILES',
  ].filter((label): label is string => Boolean(label));
  return { ...fields, missingLabels };
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: PubChemCompoundInfo | null }>();

/** 服务端 PubChem 查询，供 API 与 OCR 队列共同复用。404 会短期缓存，避免重复慢查询。 */
export async function lookupPubChemByCas(cas: string): Promise<PubChemCompoundInfo | null> {
  const normalizedCas = cas.trim();
  if (!normalizedCas) return null;
  const cached = cache.get(normalizedCas);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const baseUrl = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name';
  const propsUrl = `${baseUrl}/${encodeURIComponent(normalizedCas)}/property/MolecularFormula,MolecularWeight,IUPACName,Title,CanonicalSMILES,IsomericSMILES,ConnectivitySMILES/JSON`;
  const response = await fetchUpstream(propsUrl, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
  });

  if (response.status === 404) {
    cache.set(normalizedCas, { expiresAt: Date.now() + CACHE_TTL_MS, value: null });
    return null;
  }
  if (!response.ok) throw new Error(`PubChem 查询失败（HTTP ${response.status}）`);

  const data = await response.json();
  const compound = data?.PropertyTable?.Properties?.[0];
  if (!compound) return null;
  const smiles = compound.IsomericSMILES || compound.CanonicalSMILES || compound.ConnectivitySMILES || null;
  const value: PubChemCompoundInfo = {
    cas: normalizedCas,
    cid: typeof compound.CID === 'number' ? compound.CID : null,
    molecularFormula: compound.MolecularFormula || null,
    molecularWeight: compound.MolecularWeight ? String(compound.MolecularWeight) : null,
    iupacName: compound.IUPACName || null,
    title: compound.Title || null,
    smiles,
    canonicalSmiles: compound.CanonicalSMILES || compound.ConnectivitySMILES || null,
    isomericSmiles: compound.IsomericSMILES || null,
    structureImgUrl: `${baseUrl}/${encodeURIComponent(normalizedCas)}/PNG`,
  };
  cache.set(normalizedCas, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
