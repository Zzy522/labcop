import { describe, expect, it } from 'vitest';
import { resolvePubChemStructureUrl } from '@/lib/structure-image-server';

describe('resolvePubChemStructureUrl', () => {
  it('prefers a valid CAS fallback over stored links and SMILES', () => {
    expect(resolvePubChemStructureUrl({
      casNumber: '64-17-5',
      smiles: 'CCO',
      storedPubChemUrl: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/ethanol/PNG',
    })).toBe('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/64-17-5/PNG');
  });

  it('accepts only trusted stored PubChem image URLs', () => {
    expect(resolvePubChemStructureUrl({
      storedPubChemUrl: 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/ethanol/PNG',
    })).toContain('pubchem.ncbi.nlm.nih.gov');
    expect(resolvePubChemStructureUrl({ storedPubChemUrl: 'https://example.com/structure.png' })).toBeNull();
  });

  it('uses SMILES as the final PubChem fallback', () => {
    expect(resolvePubChemStructureUrl({ smiles: 'C/C=C\\O' }))
      .toBe('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/C%2FC%3DC%5CO/PNG');
  });
});

