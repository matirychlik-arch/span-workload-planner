import { Assignment } from '@/lib/domain/types';
import {
  clamp,
  DAY_END_HOUR,
  DAY_START_HOUR,
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

function pushAfter(candidate: Assignment, nextStart: number): Assignment {
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
  // Each occupied hour stores the latest blocker end. Checking a block now
  // depends on its span (at most 10 days x 8 hours), not the planner's history.
  const occupancy = new Map<string, Map<number, number[]>>();
  for (const item of ordered) {
    let employeeDays = occupancy.get(item.employeeId);
    if (!employeeDays) {
      employeeDays = new Map();
      occupancy.set(item.employeeId, employeeDays);
    }
    const firstDay = Date.parse(`${item.startDate}T00:00:00Z`) / 86_400_000;
    const days = Array.from({ length: item.durationDays }, (_, offset) => {
      const day = firstDay + offset;
      let hours = employeeDays.get(day);
      if (!hours) {
        hours = Array<number>(DAY_END_HOUR - DAY_START_HOUR).fill(0);
        employeeDays.set(day, hours);
      }
      return hours;
    });
    let candidate = {
      ...item,
      startHour: clamp(item.desiredStartHour || item.startHour, DAY_START_HOUR, DAY_END_HOUR - 1)
    };
    candidate.durationHours = Math.max(1, Math.min(candidate.durationHours, DAY_END_HOUR - candidate.startHour));

    while (true) {
      let blockerEnd = 0;
      for (const hours of days) {
        for (let hour = candidate.startHour; hour < assignmentEndHour(candidate); hour += 1) {
          blockerEnd = Math.max(blockerEnd, hours[hour - DAY_START_HOUR]);
        }
      }
      if (!blockerEnd) break;
      const next = pushAfter(candidate, blockerEnd);
      // At the end of a full day the old loop repeated the same collision
      // once per assignment. Keep its final placement without retrying it.
      if (next.startHour === candidate.startHour && next.durationHours === candidate.durationHours) break;
      candidate = next;
    }
    for (const hours of days) {
      for (let hour = candidate.startHour; hour < assignmentEndHour(candidate); hour += 1) {
        hours[hour - DAY_START_HOUR] = Math.max(hours[hour - DAY_START_HOUR], assignmentEndHour(candidate));
      }
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

export function resolveStickyForEmployees(
  assignments: Assignment[],
  employeeIds: Iterable<string>,
  pinnedAssignmentId?: string
): Assignment[] {
  const touchedEmployeeIds = new Set(employeeIds);
  if (!touchedEmployeeIds.size) return assignments;

  const byEmployee = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    if (!touchedEmployeeIds.has(assignment.employeeId)) continue;
    const list = byEmployee.get(assignment.employeeId) ?? [];
    list.push(assignment);
    byEmployee.set(assignment.employeeId, list);
  }

  if (!byEmployee.size) return assignments;

  const resolvedById = new Map<string, Assignment>();
  for (const [employeeId, group] of byEmployee.entries()) {
    const resolvedGroup = resolveStickyForEmployee(
      group,
      group.some((item) => item.id === pinnedAssignmentId) ? pinnedAssignmentId : undefined
    );
    resolvedGroup.forEach((item) => resolvedById.set(item.id, { ...item, employeeId }));
  }

  return assignments.map((assignment) => resolvedById.get(assignment.id) ?? assignment);
}
