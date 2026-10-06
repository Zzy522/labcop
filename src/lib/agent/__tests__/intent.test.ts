import { describe, expect, it } from 'vitest';
import { shouldGatherDataContext, shouldUseAgentTools } from '@/lib/agent/intent';

describe('shouldUseAgentTools', () => {
  it('keeps general conversation on the single-call fast path', () => {
    expect(shouldUseAgentTools('自我介绍一下')).toBe(false);
    expect(shouldUseAgentTools('盐酸接触皮肤后如何处理？')).toBe(false);
  });

  it('routes real-time laboratory data questions to tools', () => {
    expect(shouldUseAgentTools('查询一下实验室里的乙醇库存')).toBe(true);
    expect(shouldUseAgentTools('阿司匹林的生物活性数据是什么？')).toBe(true);
    expect(shouldUseAgentTools('乙腈存放位置在哪里？')).toBe(true);
  });
});

describe('shouldGatherDataContext', () => {
  it('refreshes research data for direct weekly-report and attachment questions', () => {
    expect(shouldGatherDataContext('RESEARCH', '刚提交的周报和附件能看到吗')).toBe(true);
  });

  it('refreshes underspecified follow-ups when the recent conversation concerns project data', () => {
    expect(shouldGatherDataContext('RESEARCH', '现在有吗', ['这个课题目前有周报吗？', '目前没有。'])).toBe(true);
  });

  it('does not fetch business context for unrelated conversation', () => {
    expect(shouldGatherDataContext('RESEARCH', '现在呢', ['请介绍一下你自己'])).toBe(false);
  });
});
