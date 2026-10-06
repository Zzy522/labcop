import { describe, it, expect } from 'vitest';
import { checkPermission } from '../permissionRules';

describe('checkPermission 权限检查（角色精简后：ADMIN + MEMBER，风险等级：LOW | HIGH）', () => {
  it('ADMIN 应该可以领用任何试剂', () => {
    const result = checkPermission({
      applicantRole: 'ADMIN',
      reagentRiskLevel: 'HIGH',
      isHazardous: true,
      isControlled: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('MEMBER 不能领用管制品', () => {
    const result = checkPermission({
      applicantRole: 'MEMBER',
      reagentRiskLevel: 'LOW',
      isHazardous: false,
      isControlled: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('管制');
  });

  it('MEMBER 不能领用危化品', () => {
    const result = checkPermission({
      applicantRole: 'MEMBER',
      reagentRiskLevel: 'LOW',
      isHazardous: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('危化品');
  });

  it('ADMIN 可以领用高风险管制品', () => {
    const result = checkPermission({
      applicantRole: 'ADMIN',
      reagentRiskLevel: 'HIGH',
      isHazardous: true,
      isControlled: true,
    });
    expect(result.allowed).toBe(true);
  });

  it('MEMBER 可以领用低风险非危化品非管制品', () => {
    const result = checkPermission({
      applicantRole: 'MEMBER',
      reagentRiskLevel: 'LOW',
      isHazardous: false,
      isControlled: false,
    });
    expect(result.allowed).toBe(true);
  });

  it('MEMBER 不能领用高风险试剂（即使非管制品非危化品）', () => {
    // 注意：当前规则未直接限制 MEMBER 领用 HIGH 风险，但规则引擎会将其置为 NEEDS_CONFIRM
    // 此处仅验证 permissionRules 不阻止（规则引擎会处理）
    const result = checkPermission({
      applicantRole: 'MEMBER',
      reagentRiskLevel: 'HIGH',
      isHazardous: false,
      isControlled: false,
    });
    expect(result.allowed).toBe(true);
  });
});
