/**
 * 本地快速意图路由：仅判断是否需要查询实验室实时数据。
 * 不调用模型，因此不会增加首 Token 延迟；未命中时仍由 LLM 直接回答通用问题。
 */
const TOOL_INTENT_PATTERNS = [
  /(?:查询|查找|查一下|检索|查看).{0,12}(?:试剂|库存|化合物|靶点|活性|批次|合成路线|CAS|MSDS|SOP)/i,
  /(?:本实验室|实验室里|数据库中|系统中|当前).{0,12}(?:库存|试剂|化合物|设备|数据|记录)/i,
  /(?:库存量|库存还有|存储位置|存放位置|有效期|是否过期|入库记录)/i,
  /(?:IC50|MIC|抑菌率|细胞毒性|生物活性|合成路线|反应条件|收率|纯度).{0,16}(?:多少|查询|查看|是什么|数据|记录)?/i,
  /(?:库中|库里|知识库|数据库).{0,16}(?:有|存在|收录|包含).{0,12}(?:化合物|分子|结构)/i,
  /SMILES/i,
];

const DATA_CONTEXT_PATTERNS = {
  RESEARCH: /课题|项目|阶段|任务|进展|总结|周报|附件|上传|提交|文档|化合物|活性|靶点|合成|研究/i,
  MANAGEMENT: /审批|待办|库存|试剂|设备|预约|巡检|风险|安全|资质|报表|概况/i,
} as const;

const CONTEXTUAL_FOLLOW_UP_PATTERN = /(?:现在|目前|刚刚|刚才|这次|再|重新).*(?:有吗|有了|能看|看到|查|读取|同步)|^(?:有吗|有了没|现在呢|目前呢|能看到了吗)[？?]?$/i;

/**
 * 判断本轮是否需要重新读取业务数据。
 * 对“现在有吗”一类依赖上文的追问，会结合最近对话判断，避免沿用上一轮的旧结论。
 */
export function shouldGatherDataContext(
  mode: keyof typeof DATA_CONTEXT_PATTERNS,
  currentInput: string,
  recentConversation: string[] = []
): boolean {
  const pattern = DATA_CONTEXT_PATTERNS[mode];
  if (pattern.test(currentInput)) return true;
  if (!CONTEXTUAL_FOLLOW_UP_PATTERN.test(currentInput.trim())) return false;
  return recentConversation.slice(-6).some((content) => pattern.test(content));
}

/** Cheap local heuristic used only to decide whether the database tools should run. */
export function isLikelySmilesQuery(input: string): boolean {
  const value = input.trim();
  if (!value || /\s/.test(value)) return false;
  if (!/^[A-Za-z0-9@+\-\[\]()=#\\/%.*:]+$/.test(value)) return false;
  if (!/(?:Cl|Br|[BCNOFPSI]|[bcnops])/.test(value)) return false;

  return /[\[\]()=#@\\/]|\d/.test(value)
    || /^(?:(?:Cl|Br|[BCNOFPSI])){1,20}$/.test(value);
}

export function shouldUseAgentTools(input: string): boolean {
  const text = input.trim();
  if (!text) return false;
  if (TOOL_INTENT_PATTERNS.some((pattern) => pattern.test(text))) return true;

  return text.split(/\s+/).some((token) =>
    isLikelySmilesQuery(token.replace(/^[“”"'`]+|[“”"'`,，。；;？?]+$/g, ''))
  );
}
