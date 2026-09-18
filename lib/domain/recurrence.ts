import type { RecurrenceRule } from '@/lib/domain/types';
import { diffDays, parseIsoDate, shiftIsoDate } from '@/lib/domain/time';

export function validCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function recurrenceDates(rule: RecurrenceRule, from: string, to: string): string[] {
  if (!validCalendarDate(from) || !validCalendarDate(to) || diffDays(from, to) < 0 || diffDays(from, to) > 120) {
    throw new Error('Nieprawidłowy zakres kalendarza (maksymalnie 121 dni).');
  }
  const start = from > rule.startDate ? from : rule.startDate;
  const end = rule.until && rule.until < to ? rule.until : to;
  const generated = new Set(rule.generatedDates);
  const anchor = parseIsoDate(rule.startDate);
  const dates: string[] = [];
  for (let date = start; date <= end; date = shiftIsoDate(date, 1)) {
    if (generated.has(date)) continue;
    const current = parseIsoDate(date);
    const day = current.getDay();
    const lastDay = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
    const matches = rule.frequency === 'daily' ||
      (rule.frequency === 'weekdays' && day !== 0 && day !== 6) ||
      (rule.frequency === 'weekly' && day === anchor.getDay()) ||
      (rule.frequency === 'monthly' && current.getDate() === Math.min(anchor.getDate(), lastDay));
    if (matches) dates.push(date);
  }
  return dates;
}

export function validateRecurrence(startDate: string, durationDays: number, until: string | null): void {
  if (durationDays !== 1) throw new Error('Powtarzanie jest dostępne dla bloków jednodniowych.');
  if (until !== null && (!validCalendarDate(until) || until < startDate)) {
    throw new Error('Data końca nie może być wcześniejsza niż pierwsze wystąpienie.');
  }
}

export const recurrenceColumns = 'id, workspace_id, team_id, task_id, employee_id, start_date, start_hour, duration_hours, frequency, until_date, generated_dates';
export type RecurrenceRow = ReturnType<typeof recurrenceToRow>;
export function recurrenceFromRow(row: RecurrenceRow): RecurrenceRule {
  return { id: row.id, workspaceId: row.workspace_id, teamId: row.team_id, taskId: row.task_id,
    employeeId: row.employee_id, startDate: row.start_date, startHour: row.start_hour,
    durationHours: row.duration_hours, frequency: row.frequency, until: row.until_date ?? null,
    generatedDates: row.generated_dates ?? [] };
}
export function recurrenceToRow(rule: RecurrenceRule) {
  return { id: rule.id, workspace_id: rule.workspaceId, team_id: rule.teamId, task_id: rule.taskId,
    employee_id: rule.employeeId, start_date: rule.startDate, start_hour: rule.startHour,
    duration_hours: rule.durationHours, frequency: rule.frequency, until_date: rule.until,
    generated_dates: rule.generatedDates };
}
