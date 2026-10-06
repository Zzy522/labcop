import { describe, expect, it } from 'vitest';
import { getAssistantSystemPrompt, normalizeAssistantMode } from '../prompts';

describe('assistant mode prompts', () => {
  it('uses explicit finite modes with management as safe fallback', () => {
    expect(normalizeAssistantMode('RESEARCH')).toBe('RESEARCH');
    expect(normalizeAssistantMode('MANAGEMENT')).toBe('MANAGEMENT');
    expect(normalizeAssistantMode('unknown')).toBe('MANAGEMENT');
  });

  it('allows research summaries and consistently advertises image support', () => {
    const research = getAssistantSystemPrompt('RESEARCH');
    const management = getAssistantSystemPrompt('MANAGEMENT');
    expect(research).toContain('总结课题进展');
    expect(research).toContain('图片理解能力');
    expect(research).toContain('数据库主键');
    expect(research).toContain('绝不能向用户展示');
    expect(research).toContain('weeklyReports');
    expect(research).toContain('不得仅根据 documents 字段');
    expect(management).toContain('不得回答“职责范围不支持科研总结”');
    expect(management).toContain('图片理解能力');
  });
});
