import { Assignment } from '@/lib/domain/types';
import {
  clamp,
  DAY_END_HOUR,
  DAY_START_HOUR,
  diffDays,
  MAX_DURATION_DAYS
} from '@/lib/domain/time';

function normalizeAssignment(assignment: Assignment): Assignment {
  const normalized = { ...assignment };
  normalized.durationHours = clamp(Math.round(normalized.durationHours || 1), 1, DAY_END_HOUR - DAY_START_HOUR);
  normalized.durationDays = clamp(Math.round(normalized.durationDays || 1), 1, MAX_DURATION_DAYS);
  normalized.startHour = clamp(Math.round(normalized.startHour || DAY_START_HOUR), DAY_START_HOUR, DAY_END_HOUR - 1);
  normalized.desiredStartHour = clamp(
    Math.round(normalized.desiredStartHour || normalized.startHour),
    DAY_START_HOUR,
    DAY_END_HOUR - 1
  );
  normalized.durationHours = Math.max(1, Math.min(normalized.durationHours, DAY_END_HOUR - normalized.startHour));
  return normalized;
}

function assignmentEndHour(assignment: Assignment): number {
  return assignment.startHour + assignment.durationHours;
}

function assignmentEndDate(assignment: Assignment): string {
  const endOffset = Math.max(0, assignment.durationDays - 1);
  const date = new Date(`${assignment.startDate}T12:00:00`);
  date.setDate(date.getDate() + endOffset);
  return date.toISOString().slice(0, 10);
}

function dateRangesOverlap(a: Assignment, b: Assignment): boolean {
  return diffDays(a.startDate, assignmentEndDate(b)) >= 0 && diffDays(b.startDate, assignmentEndDate(a)) >= 0;
}

function timeRangesOverlap(a: Assignment, b: Assignment): boolean {
  return a.startHour < assignmentEndHour(b) && b.startHour < assignmentEndHour(a);
}

function assignmentsOverlap(a: Assignment, b: Assignment): boolean {
  return a.employeeId === b.employeeId && dateRangesOverlap(a, b) && timeRangesOverlap(a, b);
}

function pushAfter(candidate: Assignment, blockers: Assignment[]): Assignment {
  const nextStart = Math.max(...blockers.map(assignmentEndHour));
  const adjusted = { ...candidate };
  adjusted.startHour = Math.min(nextStart, DAY_END_HOUR - 1);
  adjusted.durationHours = Math.max(1, Math.min(adjusted.durationHours, DAY_END_HOUR - adjusted.startHour));
  return adjusted;
}

function sortAssignments(a: Assignment, b: Assignment): number {
  return (
    a.startHour - b.startHour ||
    a.durationDays - b.durationDays ||
    a.startDate.localeCompare(b.startDate) ||
    a.taskId.localeCompare(b.taskId) ||
    a.id.localeCompare(b.id)
  );
}

export function resolveStickyForEmployee(assignments: Assignment[], pinnedAssignmentId?: string): Assignment[] {
  const normalized = assignments.map(normalizeAssignment);
  const pinned = pinnedAssignmentId ? normalized.find((item) => item.id === pinnedAssignmentId) : undefined;
  const ordered = pinned
    ? [pinned, ...normalized.filter((item) => item.id !== pinned.id).sort(sortAssignments)]
    : [...normalized].sort(sortAssignments);

  const placed: Assignment[] = [];
  for (const item of ordered) {
    let candidate = {
      ...item,
      startHour: clamp(item.desiredStartHour || item.startHour, DAY_START_HOUR, DAY_END_HOUR - 1)
    };
    candidate.durationHours = Math.max(1, Math.min(candidate.durationHours, DAY_END_HOUR - candidate.startHour));

    let blockers = placed.filter((existing) => assignmentsOverlap(candidate, existing));
    let guard = 0;
    while (blockers.length > 0 && guard < ordered.length + 2) {
      candidate = pushAfter(candidate, blockers);
      blockers = placed.filter((existing) => assignmentsOverlap(candidate, existing));
      guard += 1;
    }
    placed.push(candidate);
  }
  return placed;
}

export function resolveSticky(assignments: Assignment[], pinnedAssignmentId?: string): Assignment[] {
  const byEmployee = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    const list = byEmployee.get(assignment.employeeId) ?? [];
    list.push(assignment);
    byEmployee.set(assignment.employeeId, list);
  }

  const resolved: Assignment[] = [];
  for (const [employeeId, group] of byEmployee.entries()) {
    const resolvedGroup = resolveStickyForEmployee(
      group,
      group.some((item) => item.id === pinnedAssignmentId) ? pinnedAssignmentId : undefined
    );
    resolved.push(...resolvedGroup.map((item) => ({ ...item, employeeId })));
  }
  return resolved;
}
