import { describe, expect, it } from 'vitest';
import { isLikelySmilesQuery, shouldUseAgentTools } from '@/lib/agent/intent';

describe('assistant chemical-query intent', () => {
  const complexSmiles = 'O=C1C(C2=NC(C=CC(N3CCN(CC3)C)=N4)=C4N2)=C(C5=C(N1)C=CC=C5F)N';

  it('recognizes a complex SMILES embedded in a natural-language database question', () => {
    expect(isLikelySmilesQuery(complexSmiles)).toBe(true);
    expect(shouldUseAgentTools(`${complexSmiles} 我们库中有这个化合物的信息吗`)).toBe(true);
  });

  it('routes explicit SMILES questions to tools', () => {
    expect(shouldUseAgentTools('请按 SMILES 帮我查询这个分子')).toBe(true);
  });

  it('does not mistake a CAS number or ordinary English name for SMILES', () => {
    expect(isLikelySmilesQuery('405169-16-6')).toBe(false);
    expect(isLikelySmilesQuery('aspirin')).toBe(false);
  });
});
