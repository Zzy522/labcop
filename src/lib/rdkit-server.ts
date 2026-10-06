import type { RDKitLoader, RDKitModule } from '@rdkit/rdkit';

let rdkitPromise: Promise<RDKitModule> | null = null;

export interface SmilesMatchResult<T> {
  valid: boolean;
  canonicalSmiles: string | null;
  matches: T[];
}

/** Load the Node-compatible RDKit WASM module once per server process. */
export function loadServerRDKit(): Promise<RDKitModule> {
  if (rdkitPromise) return rdkitPromise;

  rdkitPromise = import('@rdkit/rdkit')
    .then(async (module) => {
      const loader = (module as unknown as { default?: RDKitLoader }).default;
      if (typeof loader !== 'function') {
        throw new Error('RDKit 服务端加载器不可用');
      }
      return loader();
    })
    .catch((error) => {
      rdkitPromise = null;
      throw error;
    });

  return rdkitPromise;
}

function canonicalizeWithRDKit(rdkit: RDKitModule, smiles: string): string | null {
  const molecule = rdkit.get_mol(smiles.trim());
  if (!molecule) return null;

  try {
    return molecule.get_smiles() || null;
  } catch {
    return null;
  } finally {
    molecule.delete();
  }
}

export async function canonicalizeServerSmiles(smiles: string): Promise<string | null> {
  if (!smiles.trim()) return null;
  return canonicalizeWithRDKit(await loadServerRDKit(), smiles);
}

/** Render a molecule locally so reagent pages do not depend on a PubChem image hotlink. */
export async function renderServerSmilesSvg(
  smiles: string,
  width = 480,
  height = 320
): Promise<string | null> {
  if (!smiles.trim()) return null;

  const molecule = (await loadServerRDKit()).get_mol(smiles.trim());
  if (!molecule) return null;

  try {
    return molecule.get_svg(width, height) || null;
  } catch {
    return null;
  } finally {
    molecule.delete();
  }
}

/**
 * Compare molecular graphs through RDKit canonical SMILES, not raw strings.
 * Equivalent inputs such as CCO, OCC and C(C)O therefore resolve to one molecule.
 */
export async function matchEquivalentSmiles<T>(
  querySmiles: string,
  records: readonly T[],
  getSmiles: (record: T) => string | null | undefined
): Promise<SmilesMatchResult<T>> {
  const rdkit = await loadServerRDKit();
  const canonicalQuery = canonicalizeWithRDKit(rdkit, querySmiles);
  if (!canonicalQuery) {
    return { valid: false, canonicalSmiles: null, matches: [] };
  }

  const matches = records.filter((record) => {
    const storedSmiles = getSmiles(record);
    if (!storedSmiles) return false;
    return canonicalizeWithRDKit(rdkit, storedSmiles) === canonicalQuery;
  });

  return { valid: true, canonicalSmiles: canonicalQuery, matches };
}
