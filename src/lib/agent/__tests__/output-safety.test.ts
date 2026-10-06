import { describe, expect, it } from 'vitest';
import { redactInternalIdentifiers } from '../output-safety';

describe('redactInternalIdentifiers', () => {
  it('removes cuid and UUID record identifiers without changing user-facing codes', () => {
    const result = redactInternalIdentifiers(
      '课题 ID: cmsj2mx2p000101r7z7cxsaol，附件 550e8400-e29b-41d4-a716-446655440000，化合物 XY-001。'
    );
    expect(result).not.toContain('cmsj2mx2p000101r7z7cxsaol');
    expect(result).not.toContain('550e8400-e29b-41d4-a716-446655440000');
    expect(result).toContain('XY-001');
  });
});
