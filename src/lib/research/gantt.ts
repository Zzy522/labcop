const DAY_MS = 24 * 60 * 60 * 1000;

export interface GanttDateRange {
  startDate: string | null;
  dueDate: string | null;
  /** 创建时间：任务未排期时作为甘特图起点的兜底 */
  createdAt?: string | null;
}

export interface GanttWeekColumn {
  key: string;
  label: string;
  start: string;
  end: string;
  compressed: boolean;
  spanWeeks: number;
}

function startOfWeek(value: Date): Date {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function asDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function makeColumn(start: Date, spanWeeks = 1, compressed = false): GanttWeekColumn {
  const end = addDays(start, spanWeeks * 7 - 1);
  const month = start.getUTCMonth() + 1;
  const day = start.getUTCDate();
  return {
    key: `${start.toISOString()}-${spanWeeks}`,
    label: compressed ? `压缩 ${spanWeeks} 周` : `${month}/${day}`,
    start: start.toISOString(),
    end: end.toISOString(),
    compressed,
    spanWeeks,
  };
}

/**
 * 生成自然周时间轴。超过 maxVisibleWeeks 时只压缩中间显示列，真实日期不变。
 */
export function buildGanttWeekColumns(
  ranges: GanttDateRange[],
  projectStart?: string | null,
  projectEnd?: string | null,
  maxVisibleWeeks = 16,
  anchorWeek?: Date | null
): GanttWeekColumn[] {
  const dates = [asDate(projectStart), asDate(projectEnd)];
  for (const range of ranges) {
    dates.push(asDate(range.startDate), asDate(range.dueDate), asDate(range.createdAt));
  }
  const validDates = dates.filter((date): date is Date => Boolean(date));
  const today = new Date();
  const min = startOfWeek(anchorWeek ?? (validDates.length ? new Date(Math.min(...validDates.map((date) => date.getTime()))) : today));
  const naturalMax = validDates.length ? new Date(Math.max(...validDates.map((date) => date.getTime()))) : addDays(today, 35);
  // 锚定模式下保证至少铺满 maxVisibleWeeks 列，让"当周"始终落在第 3 列
  const maxDate = anchorWeek
    ? new Date(Math.max(naturalMax.getTime(), addDays(min, (maxVisibleWeeks - 1) * 7).getTime()))
    : naturalMax;
  const max = startOfWeek(maxDate);
  const totalWeeks = Math.max(1, Math.round((max.getTime() - min.getTime()) / (7 * DAY_MS)) + 1);

  if (totalWeeks <= maxVisibleWeeks) {
    return Array.from({ length: totalWeeks }, (_, index) => makeColumn(addDays(min, index * 7)));
  }

  const edgeWeeks = Math.max(4, Math.floor((maxVisibleWeeks - 1) / 2));
  const middleWeeks = totalWeeks - edgeWeeks * 2;
  const leading = Array.from({ length: edgeWeeks }, (_, index) => makeColumn(addDays(min, index * 7)));
  const compressed = makeColumn(addDays(min, edgeWeeks * 7), middleWeeks, true);
  const trailingStart = totalWeeks - edgeWeeks;
  const trailing = Array.from({ length: edgeWeeks }, (_, index) => makeColumn(addDays(min, (trailingStart + index) * 7)));
  return [...leading, compressed, ...trailing];
}

/** 判断某列是否属于当前周 */
export function isCurrentWeek(column: GanttWeekColumn): boolean {
  return startOfWeek(new Date(column.start)).getTime() === startOfWeek(new Date()).getTime();
}

/** "定位近期"锚点：当周往前 2 周，使当周显示为第 3 列 */
export function recentGanttAnchor(): Date {
  return addDays(startOfWeek(new Date()), -14);
}

export function taskOverlapsWeek(
  task: GanttDateRange,
  column: GanttWeekColumn
): boolean {
  const taskStart = asDate(task.startDate) || asDate(task.dueDate);
  const taskEnd = asDate(task.dueDate) || asDate(task.startDate);
  if (!taskStart || !taskEnd) return false;
  return taskStart.getTime() <= new Date(column.end).getTime()
    && taskEnd.getTime() >= new Date(column.start).getTime();
}

