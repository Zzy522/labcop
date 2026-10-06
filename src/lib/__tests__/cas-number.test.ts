import { describe, expect, it } from 'vitest';
import { isValidCasNumber } from '@/lib/cas-number';

describe('CAS number validation', () => {
  it('accepts a valid CAS Registry Number', () => {
    expect(isValidCasNumber('6457-49-4')).toBe(true);
    expect(isValidCasNumber('7664-93-9')).toBe(true);
  });

  it('rejects OCR output with an incorrect check digit', () => {
    expect(isValidCasNumber('6457-19-4')).toBe(false);
  });

  it('rejects malformed values', () => {
    expect(isValidCasNumber('not-a-cas')).toBe(false);
  });
});
