import { describe, expect, it } from 'vitest';
import { getPubChemReagentFields, type PubChemCompoundInfo } from '@/lib/pubchem-server';

describe('PubChem confirmation enrichment', () => {
  it('fills IUPAC name and SMILES returned by PubChem', () => {
    const info: PubChemCompoundInfo = {
      cas: '64-17-5',
      cid: 702,
      molecularFormula: 'C2H6O',
      molecularWeight: '46.07',
      iupacName: 'ethanol',
      title: 'Ethanol',
      smiles: 'CCO',
      canonicalSmiles: 'CCO',
      isomericSmiles: 'CCO',
      structureImgUrl: 'https://example.test/ethanol.png',
    };
    expect(getPubChemReagentFields(info)).toMatchObject({
      iupacName: 'ethanol',
      smiles: 'CCO',
      missingLabels: [],
    });
  });

  it('leaves missing PubChem values blank and reports their labels', () => {
    expect(getPubChemReagentFields(null)).toEqual({
      molecularFormula: '',
      molecularWeight: '',
      iupacName: '',
      smiles: '',
      structureImgUrl: '',
      missingLabels: ['分子式', '分子量', 'IUPAC 名称', 'SMILES'],
    });
  });
});
