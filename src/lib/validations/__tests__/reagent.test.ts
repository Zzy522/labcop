import { describe, it, expect } from 'vitest';
import { createReagentSchema, updateReagentSchema } from '../reagent';

describe('createReagentSchema', () => {
  it('合法数据应通过校验', () => {
    const result = createReagentSchema.safeParse({
      name: '浓硫酸',
      casNumber: '7664-93-9',
      specification: '500mL/瓶',
      storageLocation: '酸碱柜 A-1',
      riskLevel: 'HIGH',
      isHazardous: true,
      isControlled: true,
      stockQuantity: 5,
      labId: 'lab-1',
    });
    expect(result.success).toBe(true);
  });

  it('名称为空应校验失败', () => {
    const result = createReagentSchema.safeParse({
      name: '',
      specification: '500mL/瓶',
      storageLocation: '酸碱柜 A-1',
      labId: 'lab-1',
    });
    expect(result.success).toBe(false);
  });

  it('OCR 误识别导致 CAS 校验位错误时应失败', () => {
    const result = createReagentSchema.safeParse({
      name: '4-哌啶甲醇',
      casNumber: '6457-19-4',
      specification: '100mg/瓶',
      storageLocation: '试剂柜 A-1',
      labId: 'lab-1',
    });
    expect(result.success).toBe(false);
  });

  it('labId 为空应校验失败', () => {
    const result = createReagentSchema.safeParse({
      name: '试剂A',
      specification: '500mL/瓶',
      storageLocation: '酸碱柜 A-1',
      labId: '',
    });
    expect(result.success).toBe(false);
  });

  it('库存为负数应校验失败', () => {
    const result = createReagentSchema.safeParse({
      name: '试剂A',
      specification: '500mL/瓶',
      storageLocation: '酸碱柜 A-1',
      stockQuantity: -1,
      labId: 'lab-1',
    });
    expect(result.success).toBe(false);
  });

  it('非法 riskLevel 应校验失败', () => {
    const result = createReagentSchema.safeParse({
      name: '试剂A',
      specification: '500mL/瓶',
      storageLocation: '酸碱柜 A-1',
      riskLevel: 'INVALID',
      labId: 'lab-1',
    });
    expect(result.success).toBe(false);
  });

  it('可选字段缺失应使用默认值（specification 和 storageLocation 必填）', () => {
    const result = createReagentSchema.safeParse({
      name: '试剂A',
      specification: '500mL/瓶',
      storageLocation: '酸碱柜 A-1',
      labId: 'lab-1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.riskLevel).toBe('LOW');
      expect(result.data.isHazardous).toBe(false);
      expect(result.data.isControlled).toBe(false);
      expect(result.data.stockQuantity).toBe(0);
    }
  });

  it('缺少 specification 应校验失败', () => {
    const result = createReagentSchema.safeParse({
      name: '试剂A',
      storageLocation: '酸碱柜 A-1',
      labId: 'lab-1',
    });
    expect(result.success).toBe(false);
  });

  it('缺少 storageLocation 应校验失败', () => {
    const result = createReagentSchema.safeParse({
      name: '试剂A',
      specification: '500mL/瓶',
      labId: 'lab-1',
    });
    expect(result.success).toBe(false);
  });

  it('MEDIUM 风险等级应校验失败（已精简为 LOW | HIGH）', () => {
    const result = createReagentSchema.safeParse({
      name: '试剂A',
      specification: '500mL/瓶',
      storageLocation: '酸碱柜 A-1',
      riskLevel: 'MEDIUM',
      labId: 'lab-1',
    });
    expect(result.success).toBe(false);
  });

  it('CRITICAL 风险等级应校验失败（已精简为 LOW | HIGH）', () => {
    const result = createReagentSchema.safeParse({
      name: '试剂A',
      specification: '500mL/瓶',
      storageLocation: '酸碱柜 A-1',
      riskLevel: 'CRITICAL',
      labId: 'lab-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateReagentSchema', () => {
  it('应允许部分更新', () => {
    const result = updateReagentSchema.safeParse({ name: '新名称', version: 0 });
    expect(result.success).toBe(true);
  });

  it('必须提供版本以防覆盖旧记录', () => {
    const result = updateReagentSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

it('普通编辑拒绝直接写入库存', () => {
  expect(updateReagentSchema.safeParse({ version: 0, stockQuantity: 100 }).success).toBe(false);
});
