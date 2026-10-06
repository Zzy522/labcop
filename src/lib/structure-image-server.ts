import { isValidCasNumber } from '@/lib/cas-number';
import { renderServerSmilesSvg } from '@/lib/rdkit-server';
import { fetchUpstream } from '@/lib/upstream-fetch';

export interface StructureImageInput {
  smiles?: string | null;
  casNumber?: string | null;
  storedPubChemUrl?: string | null;
}

export interface RenderedStructureImage {
  body: string | ArrayBuffer;
  contentType: string;
  source: 'rdkit' | 'pubchem';
}

function getSafeStoredPubChemUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'pubchem.ncbi.nlm.nih.gov'
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Resolve the PubChem fallback only after local RDKit rendering has failed. */
export function resolvePubChemStructureUrl(input: StructureImageInput): string | null {
  const casNumber = input.casNumber?.trim();
  if (casNumber && isValidCasNumber(casNumber)) {
    return `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(casNumber)}/PNG`;
  }

  const storedUrl = getSafeStoredPubChemUrl(input.storedPubChemUrl);
  if (storedUrl) return storedUrl;

  const smiles = input.smiles?.trim();
  return smiles
    ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/PNG`
    : null;
}

/** Render locally with RDKit first; use PubChem only as an explicit fallback. */
export async function renderStructureImage(
  input: StructureImageInput,
  width = 480,
  height = 320
): Promise<RenderedStructureImage | null> {
  const smiles = input.smiles?.trim();
  if (smiles) {
    try {
      const svg = await renderServerSmilesSvg(smiles, width, height);
      if (svg) {
        return { body: svg, contentType: 'image/svg+xml; charset=utf-8', source: 'rdkit' };
      }
    } catch {
      // RDKit runtime/SMILES errors fall through to PubChem.
    }
  }

  const pubchemUrl = resolvePubChemStructureUrl(input);
  if (!pubchemUrl) return null;

  try {
    const upstream = await fetchUpstream(pubchemUrl, {
      headers: { Accept: 'image/png' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = upstream.headers.get('content-type') || '';
    if (!upstream.ok || !contentType.startsWith('image/')) return null;
    return {
      body: await upstream.arrayBuffer(),
      contentType,
      source: 'pubchem',
    };
  } catch {
    return null;
  }
}

