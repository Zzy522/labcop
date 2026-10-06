import { describe, it, expect } from 'vitest';
import { reviewRequisition } from '../chemicalRules';

describe('reviewRequisition 规则引擎（风险等级：LOW | HIGH，新增 isControlled）', () => {
  const baseParams = {
    reagentName: '普通试剂',
    casNumber: '1234-56-7',
    dangerCategory: '',
    riskLevel: 'LOW' as const,
    isHazardous: false,
    isControlled: false,
    quantity: 1,
    stockQuantity: 10,
    applicantRole: 'MEMBER',
    hasTraining: true,
    existingActiveRequisitions: 0,
  };

  it('低风险普通试剂应通过', () => {
    const result = reviewRequisition(baseParams);
    expect(result.result).toBe('APPROVED');
  });

  it('库存不足应阻断', () => {
    const result = reviewRequisition({ ...baseParams, quantity: 20, stockQuantity: 5 });
    expect(result.result).toBe('BLOCKED');
    expect(result.reasons.some(r => r.includes('库存不足'))).toBe(true);
  });

  it('高风险试剂需要确认', () => {
    const result = reviewRequisition({ ...baseParams, riskLevel: 'HIGH' });
    expect(result.result).toBe('NEEDS_CONFIRM');
    expect(result.reasons.some(r => r.includes('高风险'))).toBe(true);
  });

  it('管制品需要确认（即使低风险）', () => {
    const result = reviewRequisition({ ...baseParams, isControlled: true });
    expect(result.result).toBe('NEEDS_CONFIRM');
    expect(result.reasons.some(r => r.includes('管制'))).toBe(true);
  });

  it('危化品未培训应阻断', () => {
    const result = reviewRequisition({
      ...baseParams,
      isHazardous: true,
      hasTraining: false,
    });
    expect(result.result).toBe('BLOCKED');
    expect(result.reasons.some(r => r.includes('培训'))).toBe(true);
  });

  it('危化品已培训应通过', () => {
    const result = reviewRequisition({
      ...baseParams,
      isHazardous: true,
      hasTraining: true,
    });
    expect(result.result).toBe('APPROVED');
  });

  it('同时有多个危化品申请需要确认', () => {
    const result = reviewRequisition({
      ...baseParams,
      isHazardous: true,
      hasTraining: true,
      existingActiveRequisitions: 3,
    });
    expect(result.result).toBe('NEEDS_CONFIRM');
    expect(result.reasons.some(r => r.includes('较多'))).toBe(true);
  });

  it('库存不足优先级高于其他规则（即使高风险也阻断而非确认）', () => {
    const result = reviewRequisition({
      ...baseParams,
      riskLevel: 'HIGH',
      quantity: 100,
      stockQuantity: 5,
    });
    expect(result.result).toBe('BLOCKED');
  });

  it('审批通过时应有通过原因', () => {
    const result = reviewRequisition(baseParams);
    expect(result.reasons).toContain('符合领用条件');
  });

  it('CHECKOUT 模式下低风险非管制品应通过', () => {
    const result = reviewRequisition({ ...baseParams, mode: 'CHECKOUT' });
    expect(result.result).toBe('APPROVED');
  });
});
