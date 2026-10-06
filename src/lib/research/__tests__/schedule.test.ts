import { describe, expect, it } from 'vitest';
import { normalizeWeekStart, taskDueDate } from '../schedule';

describe('weekly project task schedule', () => {
  it('normalizes any selected date to Monday', () => {
    expect(normalizeWeekStart('2026-08-06T12:00:00.000Z')?.toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('derives the inclusive end date from estimated weeks', () => {
    const start = normalizeWeekStart('2026-08-03T00:00:00.000Z');
    expect(taskDueDate(start, 3)?.toISOString()).toBe('2026-08-23T00:00:00.000Z');
  });
});
