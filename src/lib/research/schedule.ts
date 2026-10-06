const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeWeekStart(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const source = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(source.getTime())) return null;
  const date = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), source.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
}

export function taskDueDate(startDate: Date | null, estimatedWeeks: number): Date | null {
  if (!startDate) return null;
  return new Date(startDate.getTime() + Math.max(1, estimatedWeeks) * 7 * DAY_MS - DAY_MS);
}

