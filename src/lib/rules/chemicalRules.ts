export type ReviewResult = 'APPROVED' | 'NEEDS_CONFIRM' | 'BLOCKED';

export interface ReviewOutput {
  result: ReviewResult;
  reasons: string[];
  suggestions: string[];
}

/** 危化品禁配规则（简化版） */
const INCOMPATIBLE_PAIRS: [string, string][] = [
  ['氧化剂', '还原剂'],
  ['酸', '碱'],
  ['易燃物', '氧化剂'],
];

/**
 * 领用审查规则引擎
 * 根据试剂信息、库存、申请者资质等判断领用是否合规
 * 风险等级精简为 LOW | HIGH，新增 isControlled（管制品）判定
 */
export function reviewRequisition(params: {
  reagentName: string;
  casNumber: string;
  dangerCategory: string;
  riskLevel: string;
  isHazardous: boolean;
  isControlled: boolean;
  quantity: number;
  stockQuantity: number;
  applicantRole: string;
  hasTraining: boolean;
  existingActiveRequisitions: number;
  mode?: string; // CHECKOUT | APPLY
}): ReviewOutput {
  const reasons: string[] = [];
  const suggestions: string[] = [];
  let result: ReviewResult = 'APPROVED';

  // 规则1：库存不足
  if (params.quantity > params.stockQuantity) {
    result = 'BLOCKED';
    reasons.push(`库存不足：申请 ${params.quantity}，当前库存 ${params.stockQuantity}`);
    suggestions.push('请等待库存补充或减少申请数量');
  }

  // 规则2：高风险试剂或管制品需要管理员确认
  if (params.riskLevel === 'HIGH' || params.isControlled) {
    if (result !== 'BLOCKED') result = 'NEEDS_CONFIRM';
    const tag = params.isControlled ? '管制品' : '高风险试剂';
    reasons.push(`${tag}需要管理员确认`);
    suggestions.push('请联系安全员或实验室管理员审批');
  }

  // 规则3：危化品需要培训
  if (params.isHazardous && !params.hasTraining) {
    result = 'BLOCKED';
    reasons.push('危化品领用需要完成安全培训');
    suggestions.push('请先完成危化品安全培训课程');
  }

  // 规则4：同一个人同时领用多种危化品
  if (params.isHazardous && params.existingActiveRequisitions >= 3) {
    if (result !== 'BLOCKED') result = 'NEEDS_CONFIRM';
    reasons.push('当前有较多未完成的危化品领用申请');
    suggestions.push('请确认是否需要同时使用多种危化品');
  }

  // 导出禁配规则供其他模块引用
  void INCOMPATIBLE_PAIRS;

  if (result === 'APPROVED') {
    reasons.push('符合领用条件');
  }

  return { result, reasons, suggestions };
}

/** 获取禁配规则列表（供外部查询） */
export function getIncompatiblePairs(): readonly [string, string][] {
  return INCOMPATIBLE_PAIRS;
}
