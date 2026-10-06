import { describe, expect, it } from 'vitest';
import {
  canonicalizeServerSmiles,
  matchEquivalentSmiles,
  renderServerSmilesSvg,
} from '@/lib/rdkit-server';

describe('server RDKit matching', () => {
  it('canonicalizes equivalent SMILES to the same molecular graph', async () => {
    const [left, right] = await Promise.all([
      canonicalizeServerSmiles('CCO'),
      canonicalizeServerSmiles('OCC'),
    ]);

    expect(left).toBeTruthy();
    expect(right).toBe(left);
  });

  it('matches an equivalent representation instead of comparing raw strings', async () => {
    const records = [
      { id: 'ethanol', smiles: 'OCC' },
      { id: 'acetone', smiles: 'CC(=O)C' },
      { id: 'missing', smiles: null },
    ];

    const result = await matchEquivalentSmiles('C(C)O', records, (record) => record.smiles);

    expect(result.valid).toBe(true);
    expect(result.matches.map((record) => record.id)).toEqual(['ethanol']);
  });

  it('reports invalid SMILES without matching records', async () => {
    const result = await matchEquivalentSmiles('not-a-smiles', [], () => null);
    expect(result).toEqual({ valid: false, canonicalSmiles: null, matches: [] });
  });

  it('renders a local SVG structure from stored SMILES', async () => {
    const svg = await renderServerSmilesSvg('CCO', 320, 240);

    expect(svg).toContain('<svg');
    expect(svg).toContain('width=\'320px\'');
    expect(svg).toContain('height=\'240px\'');
  });
});
