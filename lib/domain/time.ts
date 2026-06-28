export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 19;
export const HOURS_PER_DAY = DAY_END_HOUR - DAY_START_HOUR;
export const MAX_DURATION_DAYS = 10;

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

export function toIsoDate(date: Date): string {
  const normalized = new Date(date);
  normalized.setHours(12, 0, 0, 0);
  return normalized.toISOString().slice(0, 10);
}

export function addDays(date: Date, amount: number): Date {
  const output = new Date(date);
  output.setDate(output.getDate() + amount);
  return output;
}

export function shiftIsoDate(iso: string, amount: number): string {
  return toIsoDate(addDays(parseIsoDate(iso), amount));
}

export function diffDays(fromIso: string, toIso: string): number {
  return Math.round((parseIsoDate(toIso).getTime() - parseIsoDate(fromIso).getTime()) / 86_400_000);
}

export function mondayOf(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy;
}

export function weekRangeFor(date: Date): { from: string; to: string } {
  const start = mondayOf(date);
  const end = addDays(start, 6);
  return {
    from: toIsoDate(start),
    to: toIsoDate(end)
  };
}

export function startOfCurrentWeek(): Date {
  return mondayOf(new Date());
}

export function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}
