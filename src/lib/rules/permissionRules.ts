/**
 * 权限规则检查
 * 判断申请者角色是否有权领用指定风险等级的试剂
 * 角色精简后：ADMIN 可领用所有，MEMBER 受限
 * 风险等级精简为 LOW | HIGH，新增 isControlled（管制品）判定
 */
export function checkPermission(params: {
  applicantRole: string;
  reagentRiskLevel: string;
  isHazardous: boolean;
  isControlled?: boolean;
}): { allowed: boolean; reason?: string } {
  // MEMBER 不能领用高风险管制品（需管理员申请）
  if (params.applicantRole === 'MEMBER' && params.isControlled) {
    return { allowed: false, reason: '实验员不能领用管制品，需由管理员申请' };
  }
  // MEMBER 领用危化品需要管理员权限
  if (params.applicantRole === 'MEMBER' && params.isHazardous) {
    return { allowed: false, reason: '实验员领用危化品需要管理员权限' };
  }
  return { allowed: true };
}
