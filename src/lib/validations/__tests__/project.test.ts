import { describe, expect, it } from 'vitest';
import { projectCreateSchema, projectMembersSchema, taskCreateSchema, weeklyReportSchema } from '../project';

describe('project manager constraints', () => {
  it('requires one to three project managers when creating a project', () => {
    expect(projectCreateSchema.safeParse({ name: '新药筛选', managerIds: [] }).success).toBe(false);
    expect(projectCreateSchema.safeParse({ name: '新药筛选', managerIds: ['u1'] }).success).toBe(true);
    expect(projectCreateSchema.safeParse({ name: '新药筛选', managerIds: ['u1', 'u2', 'u3', 'u4'] }).success).toBe(false);
  });

  it('rejects duplicate managers and overlapping member roles', () => {
    expect(projectMembersSchema.safeParse({ managerIds: ['u1', 'u1'], memberIds: [] }).success).toBe(false);
    expect(projectMembersSchema.safeParse({ managerIds: ['u1'], memberIds: ['u1'] }).success).toBe(false);
    expect(projectMembersSchema.safeParse({ managerIds: ['u1', 'u2'], memberIds: ['u3'] }).success).toBe(true);
  });
});

describe('project gantt and weekly report constraints', () => {
  it('accepts only 20 percent progress steps', () => {
    expect(taskCreateSchema.safeParse({ name: '样品表征', progress: 20 }).success).toBe(true);
    expect(taskCreateSchema.safeParse({ name: '样品表征', progress: 35 }).success).toBe(false);
  });

  it('uses week duration and a controlled task tag', () => {
    expect(taskCreateSchema.safeParse({ name: '样品表征', estimatedWeeks: 4, tags: ['进行'] }).success).toBe(true);
    expect(taskCreateSchema.safeParse({ name: '样品表征', estimatedWeeks: 0, tags: ['进行'] }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ name: '样品表征', estimatedWeeks: 4, tags: ['自定义标签'] }).success).toBe(false);
  });

  it('validates a substantive weekly report', () => {
    expect(weeklyReportSchema.safeParse({
      weekStart: '2026-08-03T00:00:00.000Z',
      title: '第 1 周进展',
      content: '本周已完成样品制备并开始结构表征。',
    }).success).toBe(true);
    expect(weeklyReportSchema.safeParse({
      weekStart: '2026-08-03T00:00:00.000Z',
      title: '周报',
      content: '太短',
    }).success).toBe(false);
  });
});
