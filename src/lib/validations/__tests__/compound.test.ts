import { describe, expect, it } from 'vitest';
import { createCompoundSchema, importCompoundSchema } from '../compound';

const validCompound = {
  name: 'LC-001',
  smiles: 'CCO',
  stockQuantity: 10,
  stockUnit: 'mg',
  storageLocation: 'A-01',
};

describe('compound project association', () => {
  it('requires a project when creating a compound interactively', () => {
    expect(createCompoundSchema.safeParse(validCompound).success).toBe(false);
    expect(createCompoundSchema.safeParse({ ...validCompound, projectId: 'project-1' }).success).toBe(true);
  });

  it('keeps legacy CSV imports compatible without a project column', () => {
    expect(importCompoundSchema.safeParse(validCompound).success).toBe(true);
  });
});
