import { describe, expect, it, vi } from 'vitest';
import { getMolInfo } from '@/lib/rdkit';

describe('getMolInfo', () => {
  it('builds a Hill formula and molecular weight from RDKit MinimalLib data', () => {
    const remove = vi.fn();
    const mol = {
      is_valid: () => true,
      get_json: () => JSON.stringify({
        defaults: { atom: { z: 6, impHs: 0 } },
        molecules: [{ atoms: [{ impHs: 3 }, { impHs: 2 }, { z: 8, impHs: 1 }] }],
      }),
      get_descriptors: () => JSON.stringify({ amw: 46.069 }),
      get_smiles: () => 'CCO',
      delete: remove,
    };
    const rdkit = { get_mol: () => mol };

    expect(getMolInfo(rdkit, 'CCO')).toEqual({
      formula: 'C2H6O',
      molecularWeight: 46.069,
      canonicalSmiles: 'CCO',
    });
    expect(remove).toHaveBeenCalledOnce();
  });
});

