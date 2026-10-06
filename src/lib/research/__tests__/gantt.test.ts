import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGanttWeekColumns, isCurrentWeek, recentGanttAnchor, taskOverlapsWeek } from '../gantt';

describe('project gantt week axis', () => {
  afterEach(() => vi.useRealTimers());
  it('uses one column per week for a short project', () => {
    const columns = buildGanttWeekColumns([], '2026-08-03T00:00:00.000Z', '2026-08-24T00:00:00.000Z');
    expect(columns).toHaveLength(4);
    expect(columns.every((column) => !column.compressed)).toBe(true);
  });

  it('compresses only the middle of a long project', () => {
    const columns = buildGanttWeekColumns([], '2026-01-05T00:00:00.000Z', '2026-12-28T00:00:00.000Z');
    expect(columns).toHaveLength(15);
    expect(columns.filter((column) => column.compressed)).toHaveLength(1);
    expect(columns.find((column) => column.compressed)?.spanWeeks).toBeGreaterThan(1);
  });

  it('keeps task overlap accurate across a compressed column', () => {
    const columns = buildGanttWeekColumns([], '2026-01-05T00:00:00.000Z', '2026-12-28T00:00:00.000Z');
    const middle = columns.find((column) => column.compressed)!;
    expect(taskOverlapsWeek({ startDate: '2026-05-01T00:00:00.000Z', dueDate: '2026-06-01T00:00:00.000Z' }, middle)).toBe(true);
  });

  it('falls back to earliest createdAt when tasks have no dates', () => {
    const columns = buildGanttWeekColumns([{ startDate: null, dueDate: null, createdAt: '2026-03-09T00:00:00.000Z' }]);
    expect(columns[0].label).toBe('3/9');
  });

  it('uses createdAt only when no other dates exist', () => {
    const columns = buildGanttWeekColumns(
      [{ startDate: null, dueDate: null, createdAt: '2026-02-02T00:00:00.000Z' }],
      '2026-01-05T00:00:00.000Z',
      '2026-01-26T00:00:00.000Z'
    );
    expect(columns[0].label).toBe('1/5');
  });

  it('anchors the axis at the given week, spanning at least maxVisibleWeeks', () => {
    const anchor = new Date('2026-08-03T00:00:00.000Z'); // 当周所在周
    const columns = buildGanttWeekColumns([{ startDate: '2026-09-01T00:00:00.000Z', dueDate: '2026-09-30T00:00:00.000Z' }], null, null, 16, anchor);
    expect(columns[0].label).toBe('8/3');
    expect(columns.length).toBeGreaterThanOrEqual(16);
  });

  it('recentGanttAnchor starts two weeks before the current week', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T18:00:00.000Z'));
    expect(recentGanttAnchor().toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('isCurrentWeek matches only the current week column', () => {
    const today = new Date();
    const columns = buildGanttWeekColumns([], null, null, 16, recentGanttAnchor());
    const currentColumns = columns.filter((column) => isCurrentWeek(column));
    expect(currentColumns.length).toBe(1);
    expect(new Date(currentColumns[0].start).getTime()).toBeLessThanOrEqual(today.getTime());
  });
});
