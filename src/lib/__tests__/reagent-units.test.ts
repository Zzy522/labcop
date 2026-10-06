import { describe, expect, it } from 'vitest';
import { computeTotalCapacity, parseSpecification } from '@/lib/reagent-units';

describe('receipt specification and inventory calculation', () => {
  it('extracts package size after purity or grade text', () => {
    expect(parseSpecification('98.75%, 10mg')).toEqual({ capacityPerUnit: 10, capacityUnit: 'mg' });
    expect(parseSpecification('AR 500ml/瓶')).toEqual({ capacityPerUnit: 500, capacityUnit: 'mL' });
    expect(parseSpecification('分析纯 100g')).toEqual({ capacityPerUnit: 100, capacityUnit: 'g' });
    expect(parseSpecification('10mg/mL, 5mL')).toEqual({ capacityPerUnit: 5, capacityUnit: 'mL' });
    expect(parseSpecification('10mg/mL')).toBeNull();
  });

  it('normalizes large package units', () => {
    expect(parseSpecification('1L/瓶')).toEqual({ capacityPerUnit: 1000, capacityUnit: 'mL' });
    expect(parseSpecification('0.5kg/瓶')).toEqual({ capacityPerUnit: 500, capacityUnit: 'g' });
  });

  it('computes total material from container count times package size', () => {
    expect(computeTotalCapacity({
      stockQuantity: 3,
      unit: '瓶',
      capacityPerUnit: 500,
      capacityUnit: 'mL',
    })).toEqual({ total: 1.5, unit: 'L' });
  });
});
