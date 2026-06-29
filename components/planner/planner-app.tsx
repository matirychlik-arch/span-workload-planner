'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { Assignment, Epic, PlannerSnapshot, Task, TeamEditMode, UserRole } from '@/lib/domain/types';
import { resolveSticky } from '@/lib/domain/sticky';
import { OWNER_EMAIL } from '@/lib/security/roles';
import {
  addDays,
  clamp,
  DAY_END_HOUR,
  DAY_START_HOUR,
  diffDays,
  isWeekend,
  pad2,
  parseIsoDate,
  shiftIsoDate,
  startOfCurrentWeek,
  toIsoDate
} from '@/lib/domain/time';

type TeamOption = {
  id: string;
  name: string;
  role: UserRole;
  editMode?: TeamEditMode;
};

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: string };
type ApiResponse<T> = ApiOk<T> | ApiFail;

type PlannerDragContext =
  | { source: 'backlog'; taskId: string }
  | {
      source: 'planner';
      anchorAssignmentId: string;
      assignmentIds: string[];
      originals: Array<{
        id: string;
        taskId: string;
        employeeId: string;
        startDate: string;
        startHour: number;
        durationHours: number;
        durationDays: number;
      }>;
    };

type ResizeContext =
  | {
      type: 'y';
      assignmentId: string;
      startY: number;
      startHours: number;
    }
  | {
      type: 'x';
      assignmentId: string;
      startX: number;
      startDays: number;
    };

type DropPreview = {
  employeeId: string;
  date: string;
  startHour: number;
  durationHours: number;
  color: string;
};

const HOUR_HEIGHT = 52;
const DAY_WIDTH = 220;
const TIMELINE_TOP = 18;
const VISIBLE_DAY_COUNT = 35;
const TIMELINE_SHIFT_DAYS = 14;
const EDGE_THRESHOLD_DAYS = 3;
const PERSON_TINTS = ['#EEF3FF', '#F6EFE8', '#EEF7EF', '#F2EDFA', '#FCF5E8', '#EBF4F4'];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });
  const body = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !body.ok) {
    const message = body && !body.ok ? body.error : 'Błąd API.';
    throw new Error(message);
  }
  return body.data;
}

function timelineLeadDays() {
  return Math.max(1, Math.floor((VISIBLE_DAY_COUNT - 7) / 2) + 1);
}

function dateLabel(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('pl-PL', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit'
  });
}

function weekLabel(weekStartIso: string): string {
  const start = parseIsoDate(weekStartIso);
  const end = addDays(start, 6);
  const left = start.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
  const right = end.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${left} - ${right}`;
}

function endDate(assignment: Assignment): string {
  return shiftIsoDate(assignment.startDate, (assignment.durationDays || 1) - 1);
}

function covers(assignment: Assignment, dateIso: string): boolean {
  return diffDays(assignment.startDate, dateIso) >= 0 && diffDays(dateIso, endDate(assignment)) >= 0;
}

function assignmentSort(a: Assignment, b: Assignment): number {
  return (
    a.startHour - b.startHour ||
    a.taskId.localeCompare(b.taskId) ||
    a.id.localeCompare(b.id)
  );
}

function isOptimisticId(id: string): boolean {
  return id.startsWith('optimistic-');
}

export function PlannerApp() {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamId, setTeamId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<PlannerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [dragContext, setDragContext] = useState<PlannerDragContext | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dropPreview, setDropPreview] = useState<DropPreview[]>([]);
  const [dropCellKey, setDropCellKey] = useState<string | null>(null);
  const [resizing, setResizing] = useState<ResizeContext | null>(null);
  const [resizeDrafts, setResizeDrafts] = useState<Record<string, { durationHours: number; durationDays: number }>>({});
  const [jiraQuery, setJiraQuery] = useState('project = MV AND status != Done');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [manualTaskTitle, setManualTaskTitle] = useState('');
  const [manualEpicId, setManualEpicId] = useState('');
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [teamEditModeDraft, setTeamEditModeDraft] = useState<TeamEditMode>('collaborative');
  const [newTeamName, setNewTeamName] = useState('');
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeeTint, setNewEmployeeTint] = useState(PERSON_TINTS[0]);
  const [employeeDrafts, setEmployeeDrafts] = useState<Record<string, { name: string; tintColor: string }>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [pendingCenterIso, setPendingCenterIso] = useState<string | null>(null);
  const [focusWeekStartIso, setFocusWeekStartIso] = useState<string>(() => toIsoDate(startOfCurrentWeek()));
  const [timelineStartIso, setTimelineStartIso] = useState<string>(() => {
    const weekStart = startOfCurrentWeek();
    return toIsoDate(addDays(weekStart, -timelineLeadDays()));
  });
  const plannerWrapRef = useRef<HTMLDivElement | null>(null);
  const shiftingRef = useRef(false);
  const timelineReloadDisabledRef = useRef(false);
  const centeredOnceRef = useRef(false);
  const resizeCommitRef = useRef<{ assignmentId: string; durationHours: number; durationDays: number } | null>(null);
  const resizeDraftsRef = useRef<Record<string, { durationHours: number; durationDays: number }>>({});

  const visibleDays = useMemo(() => {
    const start = parseIsoDate(timelineStartIso);
    return Array.from({ length: VISIBLE_DAY_COUNT }, (_, index) => toIsoDate(addDays(start, index)));
  }, [timelineStartIso]);

  const epicById = useMemo(() => {
    const map = new Map<string, Epic>();
    (snapshot?.epics ?? []).forEach((epic) => map.set(epic.id, epic));
    return map;
  }, [snapshot?.epics]);

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    (snapshot?.tasks ?? []).forEach((task) => map.set(task.id, task));
    return map;
  }, [snapshot?.tasks]);

  const canEdit = Boolean(snapshot?.canEdit);

  const assignmentsForRender = useMemo(() => {
    return (snapshot?.assignments ?? []).map((assignment) => {
      const draft = resizeDrafts[assignment.id];
      if (!draft) return assignment;
      return {
        ...assignment,
        durationHours: draft.durationHours,
        durationDays: draft.durationDays
      };
    });
  }, [snapshot?.assignments, resizeDrafts]);

  useEffect(() => {
    resizeDraftsRef.current = resizeDrafts;
  }, [resizeDrafts]);

  const plannedTaskIds = useMemo(() => {
    return new Set((snapshot?.assignments ?? []).map((assignment) => assignment.taskId));
  }, [snapshot?.assignments]);

  const backlogTasks = useMemo(() => {
    return (snapshot?.tasks ?? []).filter((task) => !plannedTaskIds.has(task.id));
  }, [snapshot?.tasks, plannedTaskIds]);

  const updateSnapshot = useCallback((next: PlannerSnapshot) => {
    setSnapshot(next);
    setResizeDrafts({});
    resizeCommitRef.current = null;
    setSelectedIds((prev) => {
      const valid = new Set(next.assignments.map((assignment) => assignment.id));
      const result = new Set<string>();
      prev.forEach((id) => {
        if (valid.has(id)) result.add(id);
      });
      return result;
    });
  }, []);

  const loadTeams = useCallback(async () => {
    const result = await api<TeamOption[]>('/api/teams');
    setTeams(result);
    if (!result.length) {
      throw new Error('Brak zespołów przypisanych do użytkownika.');
    }
    setTeamId((current) => current || result[0].id);
  }, []);

  const loadPlanner = useCallback(
    async (nextTeamId: string, rangeStartIso: string) => {
      const rangeEnd = shiftIsoDate(rangeStartIso, VISIBLE_DAY_COUNT - 1);
      const query = new URLSearchParams({
        teamId: nextTeamId,
        from: rangeStartIso,
        to: rangeEnd
      });
      const data = await api<PlannerSnapshot>(`/api/planner?${query.toString()}`);
      updateSnapshot(data);
    },
    [updateSnapshot]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        await loadTeams();
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Nie udało się załadować danych.';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTeams]);

  useEffect(() => {
    if (!teamId) return;
    if (timelineReloadDisabledRef.current) {
      timelineReloadDisabledRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError('');
        await loadPlanner(teamId, timelineStartIso);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Nie udało się załadować plannera.';
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId, timelineStartIso, loadPlanner]);

  const centerOnWeek = useCallback((weekStartIso: string) => {
    const wrap = plannerWrapRef.current;
    if (!wrap) return;
    const index = visibleDays.findIndex((day) => day === weekStartIso);
    if (index < 0) return;
    wrap.scrollLeft = Math.max(0, index * DAY_WIDTH);
  }, [visibleDays]);

  useEffect(() => {
    if (!snapshot || centeredOnceRef.current) return;
    centeredOnceRef.current = true;
    setPendingCenterIso(focusWeekStartIso);
  }, [snapshot, focusWeekStartIso]);

  useEffect(() => {
    if (!pendingCenterIso || !snapshot) return;
    const frame = requestAnimationFrame(() => {
      centerOnWeek(pendingCenterIso);
      setPendingCenterIso(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [centerOnWeek, pendingCenterIso, snapshot]);

  const moveWeek = useCallback((delta: number) => {
    const nextWeekStart = toIsoDate(addDays(parseIsoDate(focusWeekStartIso), delta * 7));
    setFocusWeekStartIso(nextWeekStart);
    const centeredStart = toIsoDate(addDays(parseIsoDate(nextWeekStart), -timelineLeadDays()));
    setTimelineStartIso(centeredStart);
    setPendingCenterIso(nextWeekStart);
  }, [focusWeekStartIso]);

  const goToday = useCallback(() => {
    const weekStart = toIsoDate(startOfCurrentWeek());
    setFocusWeekStartIso(weekStart);
    const centeredStart = toIsoDate(addDays(parseIsoDate(weekStart), -timelineLeadDays()));
    setTimelineStartIso(centeredStart);
    setPendingCenterIso(weekStart);
  }, []);

  const shiftTimelineWindow = useCallback(
    async (direction: -1 | 1) => {
      if (!teamId || shiftingRef.current) return;
      shiftingRef.current = true;
      const wrap = plannerWrapRef.current;
      const shiftPx = TIMELINE_SHIFT_DAYS * DAY_WIDTH;
      const currentLeft = wrap?.scrollLeft ?? 0;

      const nextStart = shiftIsoDate(timelineStartIso, direction * TIMELINE_SHIFT_DAYS);
      timelineReloadDisabledRef.current = true;
      setTimelineStartIso(nextStart);
      try {
        await loadPlanner(teamId, nextStart);
      } finally {
        requestAnimationFrame(() => {
          if (wrap) {
            wrap.scrollLeft = direction > 0 ? Math.max(0, currentLeft - shiftPx) : currentLeft + shiftPx;
          }
          shiftingRef.current = false;
        });
      }
    },
    [loadPlanner, teamId, timelineStartIso]
  );

  useEffect(() => {
    const wrap = plannerWrapRef.current;
    if (!wrap) return;
    const onScroll = () => {
      if (shiftingRef.current) return;
      const threshold = EDGE_THRESHOLD_DAYS * DAY_WIDTH;
      const maxLeft = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
      if (wrap.scrollLeft < threshold) {
        void shiftTimelineWindow(-1);
        return;
      }
      if (maxLeft - wrap.scrollLeft < threshold) {
        void shiftTimelineWindow(1);
      }
    };
    wrap.addEventListener('scroll', onScroll);
    return () => wrap.removeEventListener('scroll', onScroll);
  }, [shiftTimelineWindow]);

  const getDayItems = useCallback(
    (employeeId: string, dateIso: string): Assignment[] => {
      return assignmentsForRender
        .filter((assignment) => assignment.employeeId === employeeId && covers(assignment, dateIso))
        .sort(assignmentSort);
    },
    [assignmentsForRender]
  );

  const clearDropPreview = useCallback(() => {
    setDropPreview([]);
    setDropCellKey(null);
  }, []);

  const buildPlannerDragContext = useCallback(
    (anchor: Assignment): PlannerDragContext => {
      const useSelection = selectedIds.has(anchor.id) && selectedIds.size > 1;
      const assignmentIds = useSelection ? Array.from(selectedIds) : [anchor.id];
      const originals = assignmentIds
        .map((id) => snapshot?.assignments.find((assignment) => assignment.id === id))
        .filter((item): item is Assignment => Boolean(item))
        .map((item) => ({
          id: item.id,
          taskId: item.taskId,
          employeeId: item.employeeId,
          startDate: item.startDate,
          startHour: item.startHour,
          durationHours: item.durationHours,
          durationDays: item.durationDays
        }));
      return {
        source: 'planner',
        anchorAssignmentId: anchor.id,
        assignmentIds,
        originals
      };
    },
    [selectedIds, snapshot?.assignments]
  );

  const previewFromContext = useCallback(
    (
      context: PlannerDragContext | null,
      target: { employeeId: string; date: string; startHour: number }
    ): DropPreview[] => {
      if (!context) return [];
      if (context.source === 'backlog') {
        if (isOptimisticId(context.taskId)) return [];
        const task = taskById.get(context.taskId);
        const epic = task ? epicById.get(task.epicId) : undefined;
        return [
          {
            employeeId: target.employeeId,
            date: target.date,
            startHour: target.startHour,
            durationHours: 1,
            color: epic?.color ?? '#4A7FF8'
          }
        ];
      }

      const anchorOriginal = context.originals.find((item) => item.id === context.anchorAssignmentId);
      if (!anchorOriginal) return [];
      const dayDelta = diffDays(anchorOriginal.startDate, target.date);
      const hourDelta = target.startHour - anchorOriginal.startHour;

      const output: DropPreview[] = [];
      context.originals.forEach((original) => {
        const task = taskById.get(original.taskId);
        const epic = task ? epicById.get(task.epicId) : undefined;
        const nextDate = shiftIsoDate(original.startDate, dayDelta);
        const nextStart = clamp(original.startHour + hourDelta, DAY_START_HOUR, DAY_END_HOUR - 1);
        const nextHours = clamp(original.durationHours, 1, DAY_END_HOUR - nextStart);
        for (let index = 0; index < original.durationDays; index += 1) {
          output.push({
            employeeId: target.employeeId,
            date: shiftIsoDate(nextDate, index),
            startHour: nextStart,
            durationHours: nextHours,
            color: epic?.color ?? '#4A7FF8'
          });
        }
      });
      return output;
    },
    [taskById, epicById]
  );

  const buildOptimisticDropSnapshot = useCallback(
    (
      context: PlannerDragContext,
      target: { employeeId: string; date: string; startHour: number },
      copyMode: boolean
    ): PlannerSnapshot | null => {
      if (!snapshot) return null;
      const now = new Date().toISOString();

      if (context.source === 'backlog') {
        if (isOptimisticId(context.taskId)) return null;
        const task = taskById.get(context.taskId);
        if (!task) return null;
        const created: Assignment = {
          id: `optimistic-${Date.now()}`,
          workspaceId: snapshot.workspace.id,
          teamId,
          taskId: context.taskId,
          employeeId: target.employeeId,
          startDate: target.date,
          startHour: target.startHour,
          desiredStartHour: target.startHour,
          durationHours: 1,
          durationDays: 1,
          version: 1,
          updatedAt: now
        };
        return {
          ...snapshot,
          assignments: resolveSticky([...snapshot.assignments, created], created.id)
        };
      }

      const anchorOriginal = context.originals.find((item) => item.id === context.anchorAssignmentId);
      if (!anchorOriginal) return null;
      const dayDelta = diffDays(anchorOriginal.startDate, target.date);
      const hourDelta = target.startHour - anchorOriginal.startHour;

      if (copyMode) {
        const copies = context.originals.map((original, index) => ({
          ...original,
          id: `optimistic-copy-${Date.now()}-${index}`,
          workspaceId: snapshot.workspace.id,
          teamId,
          employeeId: target.employeeId,
          startDate: shiftIsoDate(original.startDate, dayDelta),
          startHour: clamp(original.startHour + hourDelta, DAY_START_HOUR, DAY_END_HOUR - 1),
          desiredStartHour: clamp(original.startHour + hourDelta, DAY_START_HOUR, DAY_END_HOUR - 1),
          version: 1,
          updatedAt: now
        }));
        return {
          ...snapshot,
          assignments: resolveSticky([...snapshot.assignments, ...copies], copies[0]?.id)
        };
      }

      const movedIds = new Set(context.assignmentIds);
      const nextAssignments = snapshot.assignments.map((assignment) => {
        if (!movedIds.has(assignment.id)) return assignment;
        const original = context.originals.find((item) => item.id === assignment.id);
        if (!original) return assignment;
        const nextStart = clamp(original.startHour + hourDelta, DAY_START_HOUR, DAY_END_HOUR - 1);
        return {
          ...assignment,
          employeeId: target.employeeId,
          startDate: shiftIsoDate(original.startDate, dayDelta),
          startHour: nextStart,
          desiredStartHour: nextStart,
          updatedAt: now,
          version: assignment.version + 1
        };
      });

      return {
        ...snapshot,
        assignments: resolveSticky(nextAssignments, context.anchorAssignmentId)
      };
    },
    [snapshot, taskById, teamId]
  );

  const handleDrop = useCallback(
    async (
      event: React.DragEvent<HTMLDivElement>,
      target: { employeeId: string; date: string; startHour: number }
    ) => {
      event.preventDefault();
      if (!canEdit || !teamId || !dragContext) return;

      const previousSnapshot = snapshot;
      const copyMode = event.altKey;
      const optimisticSnapshot = buildOptimisticDropSnapshot(dragContext, target, copyMode);
      if (optimisticSnapshot) updateSnapshot(optimisticSnapshot);

      try {
        if (dragContext.source === 'backlog') {
          if (isOptimisticId(dragContext.taskId)) {
            setError('Task jeszcze się zapisuje. Poczekaj sekundę i przeciągnij go ponownie.');
            return;
          }
          const next = await api<PlannerSnapshot>('/api/assignments/create', {
            method: 'POST',
            body: JSON.stringify({
              teamId,
              taskId: dragContext.taskId,
              employeeId: target.employeeId,
              startDate: target.date,
              startHour: target.startHour
            })
          });
          updateSnapshot(next);
          setSelectedIds(new Set());
          return;
        }

        const payload = {
          teamId,
          assignmentIds: dragContext.assignmentIds,
          anchorAssignmentId: dragContext.anchorAssignmentId,
          targetEmployeeId: target.employeeId,
          targetDate: target.date,
          targetStartHour: target.startHour
        };
        const endpoint = copyMode ? '/api/assignments/copy' : '/api/assignments/move';
        const next = await api<PlannerSnapshot>(endpoint, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        updateSnapshot(next);
        setSelectedIds(new Set());
      } catch (err) {
        if (previousSnapshot) updateSnapshot(previousSnapshot);
        const message = err instanceof Error ? err.message : 'Błąd podczas przenoszenia.';
        setError(message);
      } finally {
        setDragContext(null);
        clearDropPreview();
      }
    },
    [buildOptimisticDropSnapshot, canEdit, clearDropPreview, dragContext, snapshot, teamId, updateSnapshot]
  );

  const handleDelete = useCallback(
    async (assignmentId: string) => {
      if (!teamId || !canEdit) return;
      const toDelete = selectedIds.has(assignmentId) && selectedIds.size > 0 ? Array.from(selectedIds) : [assignmentId];
      const previousSnapshot = snapshot;
      try {
        if (snapshot) {
          const removeSet = new Set(toDelete);
          updateSnapshot({
            ...snapshot,
            assignments: resolveSticky(snapshot.assignments.filter((assignment) => !removeSet.has(assignment.id)))
          });
        }
        const next = await api<PlannerSnapshot>('/api/assignments/delete', {
          method: 'POST',
          body: JSON.stringify({ teamId, assignmentIds: toDelete })
        });
        updateSnapshot(next);
        setSelectedIds(new Set());
      } catch (err) {
        if (previousSnapshot) updateSnapshot(previousSnapshot);
        const message = err instanceof Error ? err.message : 'Błąd podczas usuwania.';
        setError(message);
      }
    },
    [canEdit, selectedIds, snapshot, teamId, updateSnapshot]
  );

  const handleResizeCommit = useCallback(
    async (assignmentId: string, durationHours?: number, durationDays?: number) => {
      if (!teamId || !canEdit) return;
      const previousSnapshot = snapshot;
      try {
        if (snapshot) {
          const nextAssignments = snapshot.assignments.map((assignment) =>
            assignment.id === assignmentId
              ? {
                  ...assignment,
                  durationHours: durationHours ?? assignment.durationHours,
                  durationDays: durationDays ?? assignment.durationDays,
                  version: assignment.version + 1,
                  updatedAt: new Date().toISOString()
                }
              : assignment
          );
          updateSnapshot({
            ...snapshot,
            assignments: resolveSticky(nextAssignments, assignmentId)
          });
        }
        const next = await api<PlannerSnapshot>('/api/assignments/resize', {
          method: 'POST',
          body: JSON.stringify({
            teamId,
            assignmentId,
            durationHours,
            durationDays
          })
        });
        updateSnapshot(next);
      } catch (err) {
        if (previousSnapshot) updateSnapshot(previousSnapshot);
        const message = err instanceof Error ? err.message : 'Błąd podczas resize.';
        setError(message);
      }
    },
    [canEdit, snapshot, teamId, updateSnapshot]
  );

  useEffect(() => {
    if (!resizing || !snapshot) return;
    const assignment = snapshot.assignments.find((item) => item.id === resizing.assignmentId);
    if (!assignment) return;

    const onMove = (event: MouseEvent) => {
      if (resizing.type === 'y') {
        const durationHours = clamp(
          resizing.startHours + Math.round((event.clientY - resizing.startY) / HOUR_HEIGHT),
          1,
          DAY_END_HOUR - assignment.startHour
        );
        const durationDays = resizeDraftsRef.current[assignment.id]?.durationDays ?? assignment.durationDays;
        resizeCommitRef.current = {
          assignmentId: assignment.id,
          durationHours,
          durationDays
        };
        setResizeDrafts((prev) => ({
          ...prev,
          [assignment.id]: {
            durationHours,
            durationDays
          }
        }));
        return;
      }
      const durationDays = clamp(
        resizing.startDays + Math.round((event.clientX - resizing.startX) / DAY_WIDTH),
        1,
        10
      );
      const durationHours = resizeDraftsRef.current[assignment.id]?.durationHours ?? assignment.durationHours;
      resizeCommitRef.current = {
        assignmentId: assignment.id,
        durationHours,
        durationDays
      };
      setResizeDrafts((prev) => ({
        ...prev,
        [assignment.id]: {
          durationHours,
          durationDays
        }
      }));
    };

    const onUp = () => {
      const draft = resizeCommitRef.current;
      if (draft) {
        void handleResizeCommit(draft.assignmentId, draft.durationHours, draft.durationDays);
      }
      setResizeDrafts((prev) => {
        const next = { ...prev };
        delete next[assignment.id];
        return next;
      });
      resizeCommitRef.current = null;
      setResizing(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [handleResizeCommit, resizing, snapshot]);

  const handleCreateTask = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!teamId || !canEdit) return;
      const title = manualTaskTitle.trim();
      if (!title) return;
      const previousSnapshot = snapshot;
      try {
        setError('');
        if (snapshot) {
          const fallbackEpicId = manualEpicId || snapshot.epics[0]?.id;
          if (fallbackEpicId) {
            updateSnapshot({
              ...snapshot,
              tasks: [
                ...snapshot.tasks,
                {
                  id: `optimistic-task-${Date.now()}`,
                  workspaceId: snapshot.workspace.id,
                  source: 'manual',
                  title,
                  epicId: fallbackEpicId,
                  status: 'todo'
                }
              ]
            });
          }
        }
        const next = await api<PlannerSnapshot>('/api/tasks/create', {
          method: 'POST',
          body: JSON.stringify({
            teamId,
            title,
            epicId: manualEpicId || undefined
          })
        });
        updateSnapshot(next);
        setManualTaskTitle('');
        setManualEpicId('');
        setTaskComposerOpen(false);
        setSidebarCollapsed(false);
      } catch (err) {
        if (previousSnapshot) updateSnapshot(previousSnapshot);
        const message = err instanceof Error ? err.message : 'Nie udało się dodać taska.';
        setError(message);
      }
    },
    [canEdit, manualEpicId, manualTaskTitle, snapshot, teamId, updateSnapshot]
  );

  const handleImportJira = useCallback(async () => {
    if (!teamId) return;
    try {
      setError('');
      await api('/api/jira/import', {
        method: 'POST',
        body: JSON.stringify({ teamId, jql: jiraQuery })
      });
      await loadPlanner(teamId, timelineStartIso);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import z Jiry nie powiódł się.';
      setError(message);
    }
  }, [jiraQuery, loadPlanner, teamId, timelineStartIso]);

  const currentTeam = useMemo(() => teams.find((team) => team.id === teamId), [teams, teamId]);
  const currentUser = useMemo(
    () => snapshot?.users.find((user) => user.id === snapshot.currentUserId),
    [snapshot]
  );
  const canManageSettings = snapshot?.currentRole === 'admin';
  const canGrantAdmins = currentUser?.email?.toLowerCase() === OWNER_EMAIL;

  useEffect(() => {
    if (!settingsOpen || !snapshot) return;
    setTeamNameDraft(currentTeam?.name ?? snapshot.team.name);
    setTeamEditModeDraft((currentTeam?.editMode ?? snapshot.team.editMode) as TeamEditMode);
    setEmployeeDrafts(
      Object.fromEntries(
        snapshot.employees.map((employee) => [
          employee.id,
          {
            name: employee.name,
            tintColor: employee.tintColor ?? PERSON_TINTS[0]
          }
        ])
      )
    );
  }, [currentTeam?.editMode, currentTeam?.name, settingsOpen, snapshot]);

  const refreshTeams = useCallback(async (nextTeamId?: string) => {
    const result = await api<TeamOption[]>('/api/teams');
    setTeams(result);
    if (nextTeamId) setTeamId(nextTeamId);
  }, []);

  const handleSaveTeamSettings = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!teamId || !canManageSettings) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/team', {
          method: 'PATCH',
          body: JSON.stringify({
            teamId,
            name: teamNameDraft,
            editMode: teamEditModeDraft
          })
        });
        updateSnapshot(next);
        await refreshTeams();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się zapisać teamu.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, refreshTeams, teamEditModeDraft, teamId, teamNameDraft, updateSnapshot]
  );

  const handleCreateTeam = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!teamId || !canManageSettings || !newTeamName.trim()) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/teams/create', {
          method: 'POST',
          body: JSON.stringify({
            teamId,
            name: newTeamName,
            editMode: 'collaborative'
          })
        });
        updateSnapshot(next);
        setNewTeamName('');
        await refreshTeams(next.team.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się utworzyć teamu.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, newTeamName, refreshTeams, teamId, updateSnapshot]
  );

  const handleCreateEmployee = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!teamId || !canManageSettings || !newEmployeeName.trim()) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/employees/create', {
          method: 'POST',
          body: JSON.stringify({
            teamId,
            name: newEmployeeName,
            tintColor: newEmployeeTint
          })
        });
        updateSnapshot(next);
        setNewEmployeeName('');
        setNewEmployeeTint(PERSON_TINTS[next.employees.length % PERSON_TINTS.length]);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się dodać pracownika.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, newEmployeeName, newEmployeeTint, teamId, updateSnapshot]
  );

  const handleSaveEmployee = useCallback(
    async (employeeId: string) => {
      if (!teamId || !canManageSettings) return;
      const draft = employeeDrafts[employeeId];
      if (!draft) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/employees/update', {
          method: 'PATCH',
          body: JSON.stringify({
            teamId,
            employeeId,
            name: draft.name,
            tintColor: draft.tintColor
          })
        });
        updateSnapshot(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się zapisać pracownika.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, employeeDrafts, teamId, updateSnapshot]
  );

  const handleDeactivateEmployee = useCallback(
    async (employeeId: string) => {
      if (!teamId || !canManageSettings) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/employees/update', {
          method: 'PATCH',
          body: JSON.stringify({
            teamId,
            employeeId,
            active: false
          })
        });
        updateSnapshot(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się usunąć pracownika.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, teamId, updateSnapshot]
  );

  const handleChangeMemberRole = useCallback(
    async (memberUserId: string, role: UserRole) => {
      if (!teamId || !canManageSettings) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/members/role', {
          method: 'PATCH',
          body: JSON.stringify({
            teamId,
            memberUserId,
            role
          })
        });
        updateSnapshot(next);
        await refreshTeams();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się zmienić roli.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, refreshTeams, teamId, updateSnapshot]
  );

  if (loading && !snapshot) {
    return <div className="state-box">Ładowanie plannera…</div>;
  }

  return (
    <div className="span-shell">
      <header className="topbar">
        <div className="topbar-main">
          <div className="brand-row">
            <img className="brand-logo" src="/assets/span-logo.svg" alt="SPAN" />
            <div className="brand-claim-wrap">
              <span className="brand-separator">|</span>
              <span className="brand-claim">Jira mówi, co trzeba zrobić. SPAN pokazuje, kiedy.</span>
            </div>
          </div>
          <button
            className="secondary topbar-settings icon-btn"
            aria-label="Ustawienia"
            title="Ustawienia"
            onClick={() => setSettingsOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M9.67 4.14a2.34 2.34 0 0 1 4.66 0 2.34 2.34 0 0 0 3.32 1.91 2.34 2.34 0 0 1 2.33 4.04 2.34 2.34 0 0 0 0 3.82 2.34 2.34 0 0 1-2.33 4.04 2.34 2.34 0 0 0-3.32 1.91 2.34 2.34 0 0 1-4.66 0 2.34 2.34 0 0 0-3.32-1.91 2.34 2.34 0 0 1-2.33-4.04 2.34 2.34 0 0 0 0-3.82 2.34 2.34 0 0 1 2.33-4.04 2.34 2.34 0 0 0 3.32-1.91Z" />
            </svg>
          </button>
        </div>
        <div className="topbar-controls">
          <div className="controls-left">
            <select
              className="team-select"
              value={teamId}
              onChange={(event) => {
                setTeamId(event.target.value);
                setSelectedIds(new Set());
              }}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <button className="secondary jira-btn" onClick={handleImportJira} disabled={!canEdit}>
              Import z Jiry
            </button>
            <button
              className="add-btn"
              disabled={!canEdit}
              onClick={() => {
                setSidebarCollapsed(false);
                setTaskComposerOpen(true);
              }}
            >
              + Dodaj blok
            </button>
          </div>
          <div className="controls-right">
            <span className={`role-badge role-${snapshot?.currentRole}`}>{snapshot?.currentRole}</span>
            <span className="mode-badge">{currentTeam?.editMode ?? snapshot?.team.editMode}</span>
            <div className="week-switch" aria-label="Przełącznik tygodnia">
              <button className="secondary nav-btn" onClick={() => moveWeek(-1)} aria-label="Poprzedni tydzień">
                ‹
              </button>
              <div className="week-range mono">{weekLabel(focusWeekStartIso)}</div>
              <button className="secondary nav-btn" onClick={() => moveWeek(1)} aria-label="Następny tydzień">
                ›
              </button>
            </div>
            <button className="secondary today-btn" onClick={goToday}>
              Dzisiaj
            </button>
          </div>
        </div>
        {!!error && <div className="error-strip">{error}</div>}
      </header>

      <main className={`main-grid ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`backlog-side ${sidebarCollapsed ? 'is-collapsed' : ''}`} data-onboarding="backlog">
          {sidebarCollapsed ? (
            <>
              <button
                className="secondary collapse-btn"
                onClick={() => setSidebarCollapsed(false)}
                aria-label="Rozwiń backlog"
                title="Rozwiń backlog"
              >
                ›
              </button>
              <div className="collapsed-label mono">Backlog</div>
            </>
          ) : (
            <>
              <div className="side-head">
                <div>
                  <div className="mono">Backlog</div>
                  <h2>Taski do zaplanowania</h2>
                  <div className="hint">Taski z Jiry i ręczne. Kolor = epic.</div>
                </div>
                <button
                  className="secondary collapse-btn"
                  onClick={() => setSidebarCollapsed(true)}
                  aria-label="Zwiń backlog"
                  title="Zwiń backlog"
                >
                  ‹
                </button>
              </div>
              {taskComposerOpen && (
                <form className="task-composer" onSubmit={handleCreateTask}>
                  <input
                    autoFocus
                    value={manualTaskTitle}
                    onChange={(event) => setManualTaskTitle(event.target.value)}
                    disabled={!canEdit}
                    placeholder="Nazwa taska"
                  />
                  <select
                    value={manualEpicId}
                    onChange={(event) => setManualEpicId(event.target.value)}
                    disabled={!canEdit}
                  >
                    <option value="">Domyślny epic</option>
                    {(snapshot?.epics ?? []).map((epic) => (
                      <option key={epic.id} value={epic.id}>
                        {epic.name}
                      </option>
                    ))}
                  </select>
                  <div className="composer-actions">
                    <button type="submit" disabled={!canEdit || !manualTaskTitle.trim()}>
                      Dodaj
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setTaskComposerOpen(false);
                        setManualTaskTitle('');
                      }}
                    >
                      Anuluj
                    </button>
                  </div>
                </form>
              )}
              <div className="section">
                <input
                  value={jiraQuery}
                  onChange={(event) => setJiraQuery(event.target.value)}
                  disabled={!canEdit}
                  placeholder="JQL"
                  style={{ width: '100%' }}
                />
              </div>
              <div className="pool">
                {backlogTasks.map((task) => {
                  const epic = epicById.get(task.epicId);
                  const taskReady = !isOptimisticId(task.id);
                  return (
                    <div
                      key={task.id}
                      className={`task ${taskReady ? '' : 'pending'}`}
                      draggable={canEdit && taskReady}
                      onDragStart={(event) => {
                        if (!canEdit || !taskReady) {
                          event.preventDefault();
                          return;
                        }
                        setDragContext({ source: 'backlog', taskId: task.id });
                        event.dataTransfer.effectAllowed = 'copyMove';
                        event.dataTransfer.setData('text/plain', `task:${task.id}`);
                      }}
                      onDragEnd={() => {
                        setDragContext(null);
                        clearDropPreview();
                      }}
                      style={{ '--task-color': epic?.color ?? '#4A7FF8' } as CSSProperties}
                    >
                      <span className="task-dot" />
                      <div className="task-title">{task.title}</div>
                      <div className="task-meta">
                        {taskReady ? `${(task.jiraKey ?? task.id).toUpperCase()} · 1h · ${epic?.name ?? 'epic'}` : 'zapisywanie...'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        <section className="planner-wrap" data-onboarding="timeline" ref={plannerWrapRef}>
          <div className="planner" style={{ '--visible-days': String(VISIBLE_DAY_COUNT) } as CSSProperties}>
            <div className="grid-header" style={{ gridTemplateColumns: `var(--name) repeat(${VISIBLE_DAY_COUNT}, var(--day))` }}>
              <div className="corner">OSOBA</div>
              {visibleDays.map((date) => {
                const weekend = isWeekend(parseIsoDate(date));
                const today = toIsoDate(new Date()) === date;
                return (
                  <div key={date} className={`day-head ${weekend ? 'weekend' : ''} ${today ? 'today' : ''}`}>
                    {dateLabel(date)}
                  </div>
                );
              })}
            </div>

            {(snapshot?.employees ?? []).map((employee, employeeIndex) => (
              <div
                key={employee.id}
                className="person-wrap"
                style={{ '--person-tint': employee.tintColor ?? PERSON_TINTS[employeeIndex % PERSON_TINTS.length] } as CSSProperties}
              >
                <div className="person-card">
                  <div className="person-name">{employee.name}</div>
                </div>
                <div className="days-row">
                  {visibleDays.map((date) => {
                    const items = getDayItems(employee.id, date);
                    const total = items.reduce((sum, assignment) => sum + assignment.durationHours, 0);
                    const cellKey = `${employee.id}|${date}`;
                    const isDropCell = dropCellKey === cellKey;
                    const weekend = isWeekend(parseIsoDate(date));

                    return (
                      <div key={cellKey} className={`day-cell ${weekend ? 'weekend' : ''} ${isDropCell ? 'over-slot' : ''}`}>
                        <div className="scale">
                          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, index) => {
                            const hour = DAY_START_HOUR + index;
                            return (
                              <div key={hour} className="time" style={{ top: `${(hour - DAY_START_HOUR) * HOUR_HEIGHT}px` }}>
                                {pad2(hour)}:00
                              </div>
                            );
                          })}
                        </div>

                        <div
                          className="drop"
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (!canEdit) return;
                            const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
                            const startHour = clamp(DAY_START_HOUR + Math.floor(y / HOUR_HEIGHT), DAY_START_HOUR, DAY_END_HOUR - 1);
                            if (dragContext?.source === 'planner' && event.dataTransfer) {
                              event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
                            }
                            setDropCellKey(cellKey);
                            setDropPreview(previewFromContext(dragContext, { employeeId: employee.id, date, startHour }));
                          }}
                          onDragLeave={() => {
                            clearDropPreview();
                          }}
                          onDrop={(event) => {
                            const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
                            const startHour = clamp(DAY_START_HOUR + Math.floor(y / HOUR_HEIGHT), DAY_START_HOUR, DAY_END_HOUR - 1);
                            void handleDrop(event, { employeeId: employee.id, date, startHour });
                          }}
                        />

                        {dropPreview
                          .filter((preview) => preview.employeeId === employee.id && preview.date === date)
                          .map((preview, index) => (
                            <div
                              key={`preview-${index}-${preview.employeeId}-${preview.date}-${preview.startHour}`}
                              className="drop-preview"
                              style={{
                                '--preview-color': preview.color,
                                top: `${TIMELINE_TOP + (preview.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 3}px`,
                                height: `${preview.durationHours * HOUR_HEIGHT - 5}px`
                              } as CSSProperties}
                            />
                          ))}

                        {items.map((assignment) => {
                          const task = taskById.get(assignment.taskId);
                          if (!task) return null;
                          const epic = epicById.get(task.epicId);
                          const isStartCell = assignment.startDate === date;
                          if (!isStartCell) return null;

                          const isSelected = selectedIds.has(assignment.id);
                          const days = assignment.durationDays || 1;
                          const widthStyle = days > 1 ? `calc(${days * 100}% - 8px)` : undefined;
                          const title = task.title;
                          const meta = `${task.jiraKey ?? task.id} · ${pad2(assignment.startHour)}:00-${pad2(assignment.startHour + assignment.durationHours)}:00${days > 1 ? ` · ${days} dni` : ''}`;

                          return (
                            <div
                              key={assignment.id}
                              data-onboarding="multiselect"
                              className={`task planned ${days > 1 ? 'multi' : ''} ${isSelected ? 'selected' : ''}`}
                              draggable={canEdit}
                              onDragStart={(event) => {
                                if (!canEdit) return;
                                if (!(event.metaKey || event.ctrlKey)) {
                                  if (!selectedIds.has(assignment.id)) {
                                    setSelectedIds(new Set([assignment.id]));
                                  }
                                }
                                const ctx = buildPlannerDragContext(assignment);
                                setDragContext(ctx);
                                event.dataTransfer.effectAllowed = 'copyMove';
                                event.dataTransfer.setData('text/plain', `assignment:${assignment.id}`);
                              }}
                              onDragEnd={() => {
                                setDragContext(null);
                                clearDropPreview();
                              }}
                              onClick={(event) => {
                                if (event.metaKey || event.ctrlKey) {
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(assignment.id)) next.delete(assignment.id);
                                    else next.add(assignment.id);
                                    return next;
                                  });
                                  return;
                                }
                                setSelectedIds(new Set([assignment.id]));
                              }}
                              style={{
                                '--task-color': epic?.color ?? '#4A7FF8',
                                top: `${TIMELINE_TOP + (assignment.startHour - DAY_START_HOUR) * HOUR_HEIGHT + 3}px`,
                                height: `${assignment.durationHours * HOUR_HEIGHT - 5}px`,
                                width: widthStyle
                              } as CSSProperties}
                            >
                              <button
                                className="delete"
                                title="Usuń"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDelete(assignment.id);
                                }}
                              >
                                ×
                              </button>
                              <div className="task-title">{title}</div>
                              <div className="task-meta">{meta}</div>
                              {canEdit && (
                                <>
                                  <div
                                    className="handle-y"
                                    data-onboarding="resize"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setSelectedIds(new Set([assignment.id]));
                                      setResizing({
                                        type: 'y',
                                        assignmentId: assignment.id,
                                        startY: event.clientY,
                                        startHours: assignment.durationHours
                                      });
                                    }}
                                  />
                                  <div
                                    className="handle-x"
                                    onMouseDown={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setSelectedIds(new Set([assignment.id]));
                                      setResizing({
                                        type: 'x',
                                        assignmentId: assignment.id,
                                        startX: event.clientX,
                                        startDays: assignment.durationDays || 1
                                      });
                                    }}
                                  />
                                </>
                              )}
                            </div>
                          );
                        })}

                        <div className={`sum ${total > DAY_END_HOUR - DAY_START_HOUR ? 'over' : total === DAY_END_HOUR - DAY_START_HOUR ? 'ok' : ''}`}>
                          <span>SUMA</span>
                          <span>{total}h</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={() => setSettingsOpen(false)}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="settings-head">
              <div>
                <div className="mono">Ustawienia</div>
                <h2 id="settings-title">Teamy i pracownicy</h2>
              </div>
              <button className="secondary icon-btn close-btn" onClick={() => setSettingsOpen(false)} aria-label="Zamknij ustawienia">
                ×
              </button>
            </div>
            {!canManageSettings && (
              <div className="settings-note">Tylko admin może zmieniać teamy i pracowników.</div>
            )}
            {canManageSettings && !canGrantAdmins && (
              <div className="settings-note">Role admin może nadawać tylko {OWNER_EMAIL}.</div>
            )}
            <form className="settings-section settings-form" onSubmit={handleSaveTeamSettings}>
              <div className="settings-label">Aktywny team</div>
              <input
                value={teamNameDraft}
                onChange={(event) => setTeamNameDraft(event.target.value)}
                disabled={!canManageSettings || settingsSaving}
                placeholder="Nazwa teamu"
              />
              <select
                value={teamEditModeDraft}
                onChange={(event) => setTeamEditModeDraft(event.target.value as TeamEditMode)}
                disabled={!canManageSettings || settingsSaving}
              >
                <option value="collaborative">Collaborative: pracownicy mogą edytować swoje bloki</option>
                <option value="pm_only">PM only: edytuje tylko PM/admin</option>
              </select>
              <button type="submit" disabled={!canManageSettings || settingsSaving || !teamNameDraft.trim()}>
                Zapisz team
              </button>
            </form>
            <form className="settings-section settings-form" onSubmit={handleCreateTeam}>
              <div className="settings-label">Nowy team</div>
              <div className="settings-inline">
                <input
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  disabled={!canManageSettings || settingsSaving}
                  placeholder="Nazwa nowego teamu"
                />
                <button type="submit" disabled={!canManageSettings || settingsSaving || !newTeamName.trim()}>
                  Dodaj
                </button>
              </div>
            </form>
            <div className="settings-section">
              <div className="settings-label">Członkowie i role</div>
              <div className="member-settings-list">
                {(snapshot?.members ?? []).map((member) => {
                  const user = snapshot?.users.find((item) => item.id === member.userId);
                  return (
                    <div key={`${member.teamId}-${member.userId}`} className="member-settings-row">
                      <div>
                        <div className="member-name">{user?.name ?? member.userId}</div>
                        <div className="member-email">{user?.email ?? 'brak maila'}</div>
                      </div>
                      <select
                        value={member.role}
                        disabled={!canManageSettings || settingsSaving}
                        onChange={(event) => void handleChangeMemberRole(member.userId, event.target.value as UserRole)}
                      >
                        <option value="employee">employee</option>
                        <option value="pm">pm</option>
                        <option value="admin" disabled={!canGrantAdmins && member.role !== 'admin'}>
                          admin
                        </option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
            <form className="settings-section settings-form" onSubmit={handleCreateEmployee}>
              <div className="settings-label">Dodaj pracownika</div>
              <div className="settings-inline">
                <input
                  value={newEmployeeName}
                  onChange={(event) => setNewEmployeeName(event.target.value)}
                  disabled={!canManageSettings || settingsSaving}
                  placeholder="Imię i nazwisko"
                />
                <input
                  className="color-input"
                  type="color"
                  value={newEmployeeTint}
                  onChange={(event) => setNewEmployeeTint(event.target.value)}
                  disabled={!canManageSettings || settingsSaving}
                  aria-label="Kolor pracownika"
                />
                <button type="submit" disabled={!canManageSettings || settingsSaving || !newEmployeeName.trim()}>
                  Dodaj
                </button>
              </div>
            </form>
            <div className="settings-section">
              <div className="settings-label">Pracownicy teamu</div>
              <div className="employee-settings-list">
                {(snapshot?.employees ?? []).map((employee) => {
                  const draft = employeeDrafts[employee.id] ?? {
                    name: employee.name,
                    tintColor: employee.tintColor ?? PERSON_TINTS[0]
                  };
                  return (
                    <div key={employee.id} className="employee-settings-row">
                      <input
                        value={draft.name}
                        onChange={(event) =>
                          setEmployeeDrafts((prev) => ({
                            ...prev,
                            [employee.id]: {
                              ...draft,
                              name: event.target.value
                            }
                          }))
                        }
                        disabled={!canManageSettings || settingsSaving}
                      />
                      <input
                        className="color-input"
                        type="color"
                        value={draft.tintColor}
                        onChange={(event) =>
                          setEmployeeDrafts((prev) => ({
                            ...prev,
                            [employee.id]: {
                              ...draft,
                              tintColor: event.target.value
                            }
                          }))
                        }
                        disabled={!canManageSettings || settingsSaving}
                        aria-label={`Kolor ${employee.name}`}
                      />
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleSaveEmployee(employee.id)}
                        disabled={!canManageSettings || settingsSaving || !draft.name.trim()}
                      >
                        Zapisz
                      </button>
                      <button
                        type="button"
                        className="secondary danger-btn"
                        onClick={() => void handleDeactivateEmployee(employee.id)}
                        disabled={!canManageSettings || settingsSaving}
                      >
                        Usuń
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-label">Epiki</div>
              <div className="settings-list">
                {(snapshot?.epics ?? []).map((epic) => (
                  <span key={epic.id}>
                    <i style={{ background: epic.color }} />
                    {epic.name}
                  </span>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
