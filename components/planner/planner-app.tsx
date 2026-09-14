'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties, ChangeEvent, FormEvent } from 'react';
import type { Assignment, Epic, ExcelImportResult, PlannerSnapshot, Task, TeamEditMode, UserRole } from '@/lib/domain/types';
import { resolveSticky } from '@/lib/domain/sticky';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { OWNER_EMAIL } from '@/lib/security/roles';
import {
  addDays,
  clamp,
  DAY_END_HOUR,
  DAY_START_HOUR,
  diffDays,
  isWeekend,
  mondayOf,
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

type DropTarget = {
  employeeId: string;
  date: string;
  startHour: number;
};

type SelectionMenuPosition = {
  x: number;
  y: number;
} | null;

type TaskEditDraft = {
  assignmentId: string;
  title: string;
  description: string;
  epicId: string;
};

type PlannerZoom = 1 | 0.8 | 0.65 | 0.5;

type CloudBackupFile = {
  path: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  size?: number;
};

const HOUR_HEIGHT = 52;
const BASE_DAY_WIDTH = 220;
const TIMELINE_TOP = 18;
const PLANNER_ZOOM_OPTIONS: PlannerZoom[] = [1, 0.8, 0.65, 0.5];
const DEFAULT_PLANNER_ZOOM: PlannerZoom = 1;
const TIMELINE_BUFFER_DAYS = 35;
const TIMELINE_SHIFT_DAYS = 14;
const EDGE_THRESHOLD_DAYS = 3;
const PERSON_TINTS = ['#EEF3FF', '#F6EFE8', '#EEF7EF', '#F2EDFA', '#FCF5E8', '#EBF4F4'];
const EMPLOYEE_ORDER = ['marcin', 'mati', 'mateusz', 'pati', 'patrycja', 'adam'];
const TASK_COLOR_NAMES = Array.from({ length: 12 }, (_, index) => `kolor ${index + 1}`);

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

async function uploadForm<T>(url: string, body: FormData): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    body
  });
  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || !payload.ok) {
    const message = payload && !payload.ok ? payload.error : 'Błąd API.';
    throw new Error(message);
  }
  return payload.data;
}

function timelineLeadDays(visibleDayCount: number) {
  return Math.max(0, Math.floor((visibleDayCount - 7) / 2));
}

function dateLabel(iso: string, compact = false): string {
  if (compact) {
    return parseIsoDate(iso).toLocaleDateString('pl-PL', {
      day: '2-digit',
      month: '2-digit'
    });
  }
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

const PENDING_ASSIGNMENT_MESSAGE = 'Ten blok jeszcze się zapisuje. Poczekaj sekundę i spróbuj ponownie.';

function blocksLabel(count: number): string {
  if (count === 1) return '1 blok';
  if (count > 1 && count < 5) return `${count} bloki`;
  return `${count} bloków`;
}

function companyInitial(name?: string): string {
  return (name?.trim()[0] ?? 'F').toUpperCase();
}

function normalizedPersonToken(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')[0] ?? '';
}

function employeeRank(name: string): number {
  const token = normalizedPersonToken(name);
  const index = EMPLOYEE_ORDER.indexOf(token);
  return index >= 0 ? index : EMPLOYEE_ORDER.length;
}

function employeeDisplayName(name: string): string {
  const token = normalizedPersonToken(name);
  if (token === 'mateusz') return 'Mati';
  if (token === 'patrycja') return 'Pati';
  const first = name.split(/[-/]/)[0]?.trim().split(/\s+/)[0];
  return first || name;
}

function taskDescription(task: Task): string {
  const description = task.status?.trim();
  return description && description.toLowerCase() !== 'todo' ? description : '';
}

function normalizeColor(color: string): string {
  return color.trim().toLowerCase();
}

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function PlannerApp() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [teamId, setTeamId] = useState<string>('');
  const [snapshot, setSnapshot] = useState<PlannerSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [dragContext, setDragContext] = useState<PlannerDragContext | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMenu, setSelectionMenu] = useState<SelectionMenuPosition>(null);
  const [taskEditDraft, setTaskEditDraft] = useState<TaskEditDraft | null>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview[]>([]);
  const [dropCellKey, setDropCellKey] = useState<string | null>(null);
  const [resizing, setResizing] = useState<ResizeContext | null>(null);
  const [resizeDrafts, setResizeDrafts] = useState<Record<string, { durationHours: number; durationDays: number }>>({});
  const [jiraQuery, setJiraQuery] = useState('project = MV AND status != Done');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [manualTaskTitle, setManualTaskTitle] = useState('');
  const [manualTaskDescription, setManualTaskDescription] = useState('');
  const [manualEpicId, setManualEpicId] = useState('');
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [teamEditModeDraft, setTeamEditModeDraft] = useState<TeamEditMode>('collaborative');
  const [newTeamName, setNewTeamName] = useState('');
  const [newEmployeeName, setNewEmployeeName] = useState('');
  const [newEmployeeTint, setNewEmployeeTint] = useState(PERSON_TINTS[0]);
  const [employeeDrafts, setEmployeeDrafts] = useState<Record<string, { name: string; tintColor: string }>>({});
  const [newEpicName, setNewEpicName] = useState('');
  const [newEpicColor, setNewEpicColor] = useState('#4A7FF8');
  const [epicDrafts, setEpicDrafts] = useState<Record<string, { name: string; color: string }>>({});
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [excelImporting, setExcelImporting] = useState(false);
  const [backupWorking, setBackupWorking] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupFile[]>([]);
  const [pendingCenterIso, setPendingCenterIso] = useState<string | null>(null);
  const [plannerZoom, setPlannerZoom] = useState<PlannerZoom>(DEFAULT_PLANNER_ZOOM);
  const [copyLinkMode, setCopyLinkMode] = useState(false);
  const [focusWeekStartIso, setFocusWeekStartIso] = useState<string>(() => toIsoDate(startOfCurrentWeek()));
  const [timelineStartIso, setTimelineStartIso] = useState<string>(() => {
    const weekStart = startOfCurrentWeek();
    return toIsoDate(addDays(weekStart, -timelineLeadDays(TIMELINE_BUFFER_DAYS)));
  });
  const plannerWrapRef = useRef<HTMLDivElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const shiftingRef = useRef(false);
  const timelineReloadDisabledRef = useRef(false);
  const centeredOnceRef = useRef(false);
  const resizeCommitRef = useRef<{ assignmentId: string; durationHours: number; durationDays: number } | null>(null);
  const resizeDraftsRef = useRef<Record<string, { durationHours: number; durationDays: number }>>({});
  const plannerMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const latestPlannerMutationIdRef = useRef(0);
  const pendingPlannerMutationCountRef = useRef(0);
  const latestPlannerMutationErrorRef = useRef<string | null>(null);
  const copiedAssignmentIdsRef = useRef<string[]>([]);
  const pasteTargetRef = useRef<DropTarget | null>(null);
  const dropPreviewKeyRef = useRef<string>('');

  const visibleDayCount = TIMELINE_BUFFER_DAYS;
  const dayWidth = BASE_DAY_WIDTH;
  const scaledDayWidth = dayWidth * plannerZoom;

  const visibleDays = useMemo(() => {
    const start = parseIsoDate(timelineStartIso);
    return Array.from({ length: visibleDayCount }, (_, index) => toIsoDate(addDays(start, index)));
  }, [timelineStartIso, visibleDayCount]);

  const epicById = useMemo(() => {
    const map = new Map<string, Epic>();
    (snapshot?.epics ?? []).forEach((epic) => map.set(epic.id, epic));
    return map;
  }, [snapshot?.epics]);

  const colorPaletteEpics = useMemo(() => {
    const epics = snapshot?.epics ?? [];
    const bySystemName = new Map(epics.map((epic) => [epic.name.trim().toLowerCase(), epic]));
    const systemPalette = TASK_COLOR_NAMES.map((name) => bySystemName.get(name)).filter((epic): epic is Epic => Boolean(epic));
    if (systemPalette.length) return systemPalette;

    const uniqueByColor = new Map<string, Epic>();
    epics.forEach((epic) => {
      const color = normalizeColor(epic.color);
      if (!uniqueByColor.has(color)) uniqueByColor.set(color, epic);
    });
    return Array.from(uniqueByColor.values()).slice(0, 16);
  }, [snapshot?.epics]);

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    (snapshot?.tasks ?? []).forEach((task) => map.set(task.id, task));
    return map;
  }, [snapshot?.tasks]);

  const canEdit = Boolean(snapshot?.canEdit);
  const canImportExternal = snapshot?.currentRole === 'admin' || snapshot?.currentRole === 'pm';

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

  const assignmentsByCell = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    assignmentsForRender.forEach((assignment) => {
      const days = assignment.durationDays || 1;
      for (let index = 0; index < days; index += 1) {
        const date = shiftIsoDate(assignment.startDate, index);
        const key = `${assignment.employeeId}|${date}`;
        const list = map.get(key) ?? [];
        list.push(assignment);
        map.set(key, list);
      }
    });
    map.forEach((list) => list.sort(assignmentSort));
    return map;
  }, [assignmentsForRender]);

  const selectedAssignments = useMemo(() => {
    return assignmentsForRender.filter((assignment) => selectedIds.has(assignment.id));
  }, [assignmentsForRender, selectedIds]);

  const selectedEpicIds = useMemo(() => {
    const ids = new Set<string>();
    selectedAssignments.forEach((assignment) => {
      const task = taskById.get(assignment.taskId);
      if (task) ids.add(task.epicId);
    });
    return ids;
  }, [selectedAssignments, taskById]);

  useEffect(() => {
    resizeDraftsRef.current = resizeDrafts;
  }, [resizeDrafts]);

  const plannedTaskIds = useMemo(() => {
    return new Set((snapshot?.assignments ?? []).map((assignment) => assignment.taskId));
  }, [snapshot?.assignments]);

  const backlogTasks = useMemo(() => {
    return (snapshot?.tasks ?? []).filter((task) => !plannedTaskIds.has(task.id));
  }, [snapshot?.tasks, plannedTaskIds]);

  const employeesForRender = useMemo(() => {
    return [...(snapshot?.employees ?? [])].sort(
      (a, b) => employeeRank(a.name) - employeeRank(b.name) || employeeDisplayName(a.name).localeCompare(employeeDisplayName(b.name), 'pl')
    );
  }, [snapshot?.employees]);

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

  useEffect(() => {
    if (!selectedIds.size) {
      setSelectionMenu(null);
      setTaskEditDraft(null);
    }
  }, [selectedIds]);

  useEffect(() => {
    if (selectedAssignments.length !== 1) {
      setTaskEditDraft(null);
      return;
    }
    const assignment = selectedAssignments[0];
    const task = taskById.get(assignment.taskId);
    if (!task) return;
    setTaskEditDraft((current) => {
      if (current?.assignmentId === assignment.id) return current;
      return {
        assignmentId: assignment.id,
        title: task.title,
        description: task.status === 'todo' ? '' : task.status ?? '',
        epicId: task.epicId
      };
    });
  }, [selectedAssignments, taskById]);

  const loadTeams = useCallback(async () => {
    const result = await api<TeamOption[]>('/api/teams');
    setTeams(result);
    if (!result.length) {
      setTeamId('');
      setSnapshot(null);
      return;
    }
    setTeamId((current) => current || result[0].id);
  }, []);

  const loadPlanner = useCallback(
    async (nextTeamId: string, rangeStartIso: string) => {
      const rangeEnd = shiftIsoDate(rangeStartIso, visibleDayCount - 1);
      const query = new URLSearchParams({
        teamId: nextTeamId,
        from: rangeStartIso,
        to: rangeEnd
      });
      const data = await api<PlannerSnapshot>(`/api/planner?${query.toString()}`);
      if (pendingPlannerMutationCountRef.current === 0) {
        updateSnapshot(data);
      }
    },
    [updateSnapshot, visibleDayCount]
  );

  const queuePlannerCommit = useCallback(
    (request: () => Promise<PlannerSnapshot>, errorFallback: string) => {
      const mutationId = latestPlannerMutationIdRef.current + 1;
      latestPlannerMutationIdRef.current = mutationId;
      pendingPlannerMutationCountRef.current += 1;
      latestPlannerMutationErrorRef.current = null;

      const run = async () => {
        try {
          const next = await request();
          if (mutationId === latestPlannerMutationIdRef.current) latestPlannerMutationErrorRef.current = null;
          pendingPlannerMutationCountRef.current = Math.max(0, pendingPlannerMutationCountRef.current - 1);
          if (mutationId === latestPlannerMutationIdRef.current && pendingPlannerMutationCountRef.current === 0) {
            updateSnapshot(next);
          }
        } catch (err) {
          pendingPlannerMutationCountRef.current = Math.max(0, pendingPlannerMutationCountRef.current - 1);
          const message = err instanceof Error ? err.message : errorFallback;
          if (mutationId === latestPlannerMutationIdRef.current) latestPlannerMutationErrorRef.current = message;
          setError(message);
          if (mutationId === latestPlannerMutationIdRef.current && teamId) {
            try {
              await loadPlanner(teamId, timelineStartIso);
            } catch (reloadErr) {
              const reloadMessage = reloadErr instanceof Error ? reloadErr.message : 'Nie udało się odświeżyć plannera.';
              setError(`${message} ${reloadMessage}`);
            }
          }
        }
      };

      plannerMutationQueueRef.current = plannerMutationQueueRef.current.catch(() => undefined).then(run);
      void plannerMutationQueueRef.current;
    },
    [loadPlanner, teamId, timelineStartIso, updateSnapshot]
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
    wrap.scrollLeft = Math.max(0, index * scaledDayWidth);
  }, [scaledDayWidth, visibleDays]);

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
    const centeredStart = toIsoDate(addDays(parseIsoDate(nextWeekStart), -timelineLeadDays(visibleDayCount)));
    setTimelineStartIso(centeredStart);
    setPendingCenterIso(nextWeekStart);
  }, [focusWeekStartIso, visibleDayCount]);

  const goToday = useCallback(() => {
    const weekStart = toIsoDate(startOfCurrentWeek());
    setFocusWeekStartIso(weekStart);
    const centeredStart = toIsoDate(addDays(parseIsoDate(weekStart), -timelineLeadDays(visibleDayCount)));
    setTimelineStartIso(centeredStart);
    setPendingCenterIso(weekStart);
  }, [visibleDayCount]);

  const handleZoomChange = useCallback(
    (nextZoom: PlannerZoom) => {
      setPlannerZoom(nextZoom);
      setPendingCenterIso(focusWeekStartIso);
    },
    [focusWeekStartIso]
  );

  const zoomTimeline = useCallback(
    (direction: -1 | 1) => {
      const currentIndex = PLANNER_ZOOM_OPTIONS.indexOf(plannerZoom);
      const nextIndex = clamp(currentIndex + direction, 0, PLANNER_ZOOM_OPTIONS.length - 1);
      handleZoomChange(PLANNER_ZOOM_OPTIONS[nextIndex]);
    },
    [handleZoomChange, plannerZoom]
  );

  const shiftTimelineWindow = useCallback(
    async (direction: -1 | 1) => {
      if (!teamId || shiftingRef.current) return;
      shiftingRef.current = true;
      const wrap = plannerWrapRef.current;
      const shiftPx = TIMELINE_SHIFT_DAYS * scaledDayWidth;
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
    [loadPlanner, scaledDayWidth, teamId, timelineStartIso]
  );

  useEffect(() => {
    const wrap = plannerWrapRef.current;
    if (!wrap) return;
    const onScroll = () => {
      if (shiftingRef.current) return;
      const threshold = EDGE_THRESHOLD_DAYS * scaledDayWidth;
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
  }, [scaledDayWidth, shiftTimelineWindow]);

  const getDayItems = useCallback(
    (employeeId: string, dateIso: string): Assignment[] => {
      return assignmentsByCell.get(`${employeeId}|${dateIso}`) ?? [];
    },
    [assignmentsByCell]
  );

  const clearDropPreview = useCallback(() => {
    setDropPreview([]);
    setDropCellKey(null);
    pasteTargetRef.current = null;
    dropPreviewKeyRef.current = '';
  }, []);

  const startHourFromPointer = useCallback(
    (clientY: number, element: HTMLElement): number => {
      const y = (clientY - element.getBoundingClientRect().top) / plannerZoom;
      return clamp(DAY_START_HOUR + Math.floor(y / HOUR_HEIGHT), DAY_START_HOUR, DAY_END_HOUR - 1);
    },
    [plannerZoom]
  );

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

  const buildCopiedDragContext = useCallback((): PlannerDragContext | null => {
    if (!snapshot) return null;
    const assignmentIds = copiedAssignmentIdsRef.current.filter((id) =>
      snapshot.assignments.some((assignment) => assignment.id === id)
    );
    if (!assignmentIds.length) return null;

    const anchor = snapshot.assignments.find((assignment) => assignment.id === assignmentIds[0]);
    if (!anchor) return null;

    return {
      source: 'planner',
      anchorAssignmentId: anchor.id,
      assignmentIds,
      originals: assignmentIds
        .map((id) => snapshot.assignments.find((assignment) => assignment.id === id))
        .filter((item): item is Assignment => Boolean(item))
        .map((assignment) => ({
          id: assignment.id,
          taskId: assignment.taskId,
          employeeId: assignment.employeeId,
          startDate: assignment.startDate,
          startHour: assignment.startHour,
          durationHours: assignment.durationHours,
          durationDays: assignment.durationDays
        }))
    };
  }, [snapshot]);

  const previewFromContext = useCallback(
    (
      context: PlannerDragContext | null,
      target: DropTarget
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

  const showDropPreview = useCallback(
    (cellKey: string, context: PlannerDragContext | null, target: DropTarget) => {
      const contextKey =
        context?.source === 'planner'
          ? context.assignmentIds.join(',')
          : context?.source === 'backlog'
            ? context.taskId
            : 'empty';
      const nextKey = `${cellKey}|${target.startHour}|${contextKey}`;
      if (dropPreviewKeyRef.current === nextKey) return;
      dropPreviewKeyRef.current = nextKey;
      setDropCellKey(cellKey);
      setDropPreview(previewFromContext(context, target));
    },
    [previewFromContext]
  );

  const buildOptimisticDropSnapshot = useCallback(
    (
      context: PlannerDragContext,
      target: DropTarget,
      copyMode: boolean,
      linkTasks = false
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
        const nowMs = Date.now();
        const taskCopies: Task[] = [];
        const copies = context.originals.map((original, index) => ({
          ...original,
          id: `optimistic-copy-${nowMs}-${index}`,
          taskId: (() => {
            if (linkTasks) return original.taskId;
            const sourceTask = taskById.get(original.taskId);
            if (!sourceTask) return original.taskId;
            const taskId = `optimistic-task-copy-${nowMs}-${index}`;
            taskCopies.push({
              ...sourceTask,
              id: taskId,
              source: 'manual',
              jiraIssueId: undefined,
              jiraKey: undefined,
              url: undefined
            });
            return taskId;
          })(),
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
          tasks: taskCopies.length ? [...snapshot.tasks, ...taskCopies] : snapshot.tasks,
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
      target: DropTarget
    ) => {
      event.preventDefault();
      if (!canEdit || !teamId || !dragContext) return;

      const copyMode = event.altKey;
      const optimisticSnapshot = buildOptimisticDropSnapshot(dragContext, target, copyMode, copyMode && copyLinkMode);
      if (optimisticSnapshot) updateSnapshot(optimisticSnapshot);

      if (dragContext.source === 'backlog') {
        if (isOptimisticId(dragContext.taskId)) {
          setError('Task jeszcze się zapisuje. Poczekaj sekundę i przeciągnij go ponownie.');
          setDragContext(null);
          clearDropPreview();
          return;
        }
        queuePlannerCommit(
          () =>
            api<PlannerSnapshot>('/api/assignments/create', {
              method: 'POST',
              body: JSON.stringify({
                teamId,
                taskId: dragContext.taskId,
                employeeId: target.employeeId,
                startDate: target.date,
                startHour: target.startHour
              })
            }),
          'Błąd podczas dodawania assignmentu.'
        );
        setSelectedIds(new Set());
        setDragContext(null);
        clearDropPreview();
        return;
      }

      const payload = {
        teamId,
        assignmentIds: dragContext.assignmentIds,
        anchorAssignmentId: dragContext.anchorAssignmentId,
        targetEmployeeId: target.employeeId,
        targetDate: target.date,
        targetStartHour: target.startHour,
        linkTasks: copyMode && copyLinkMode
      };
      const endpoint = copyMode ? '/api/assignments/copy' : '/api/assignments/move';
      queuePlannerCommit(
        () =>
          api<PlannerSnapshot>(endpoint, {
            method: 'POST',
            body: JSON.stringify(payload)
          }),
        'Błąd podczas przenoszenia.'
      );
      setSelectedIds(new Set());
      setDragContext(null);
      clearDropPreview();
    },
    [buildOptimisticDropSnapshot, canEdit, clearDropPreview, copyLinkMode, dragContext, queuePlannerCommit, teamId, updateSnapshot]
  );

  const handleDelete = useCallback(
    async (assignmentId?: string) => {
      if (!teamId || !canEdit) return;
      const toDelete = assignmentId
        ? selectedIds.has(assignmentId) && selectedIds.size > 0
          ? Array.from(selectedIds)
          : [assignmentId]
        : Array.from(selectedIds);
      if (!toDelete.length) return;
      if (toDelete.some(isOptimisticId)) {
        setError(PENDING_ASSIGNMENT_MESSAGE);
        return;
      }
      if (snapshot) {
        const removeSet = new Set(toDelete);
        updateSnapshot({
          ...snapshot,
          assignments: resolveSticky(snapshot.assignments.filter((assignment) => !removeSet.has(assignment.id)))
        });
      }
      queuePlannerCommit(
        () =>
          api<PlannerSnapshot>('/api/assignments/delete', {
            method: 'POST',
            body: JSON.stringify({ teamId, assignmentIds: toDelete })
          }),
        'Błąd podczas usuwania.'
      );
      setSelectedIds(new Set());
    },
    [canEdit, queuePlannerCommit, selectedIds, snapshot, teamId, updateSnapshot]
  );

  const handleCopySelection = useCallback(() => {
    if (!selectedIds.size) return;
    const readyIds = Array.from(selectedIds).filter((id) => !isOptimisticId(id));
    copiedAssignmentIdsRef.current = readyIds;
  }, [selectedIds]);

  const handlePasteAssignments = useCallback(() => {
    if (!teamId || !canEdit || !snapshot) return;
    const context = buildCopiedDragContext();
    if (!context || context.source !== 'planner') return;
    const assignmentIds = context.assignmentIds;
    if (!assignmentIds.length) return;
    if (assignmentIds.some(isOptimisticId)) {
      setError(PENDING_ASSIGNMENT_MESSAGE);
      return;
    }

    const target = pasteTargetRef.current;
    if (!target) {
      setError('Najedź na miejsce w kalendarzu i wtedy wklej skopiowany task.');
      return;
    }
    const optimisticSnapshot = buildOptimisticDropSnapshot(context, target, true, copyLinkMode);
    if (optimisticSnapshot) updateSnapshot(optimisticSnapshot);

    queuePlannerCommit(
      () =>
        api<PlannerSnapshot>('/api/assignments/copy', {
          method: 'POST',
          body: JSON.stringify({
            teamId,
            assignmentIds,
            anchorAssignmentId: context.anchorAssignmentId,
            targetEmployeeId: target.employeeId,
            targetDate: target.date,
            targetStartHour: target.startHour,
            linkTasks: copyLinkMode
          })
        }),
      'Błąd podczas wklejania.'
    );
    setSelectedIds(new Set());
    clearDropPreview();
  }, [buildCopiedDragContext, buildOptimisticDropSnapshot, canEdit, clearDropPreview, copyLinkMode, queuePlannerCommit, snapshot, teamId, updateSnapshot]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) return;
      const key = event.key.toLowerCase();
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && key === 'c') {
        if (!selectedIds.size || !canEdit) return;
        event.preventDefault();
        handleCopySelection();
        return;
      }
      if (modifier && key === 'v') {
        if (!canEdit) return;
        event.preventDefault();
        handlePasteAssignments();
        return;
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (!selectedIds.size || !canEdit) return;
      event.preventDefault();
      void handleDelete();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canEdit, handleCopySelection, handleDelete, handlePasteAssignments, selectedIds.size]);

  const handleDeleteTasks = useCallback(
    (taskIds: string[]) => {
      if (!teamId || !canEdit || !snapshot) return;
      const readyTaskIds = taskIds.filter((taskId) => !isOptimisticId(taskId));
      if (!readyTaskIds.length) {
        setError(PENDING_ASSIGNMENT_MESSAGE);
        return;
      }

      const removeSet = new Set(readyTaskIds);
      updateSnapshot({
        ...snapshot,
        tasks: snapshot.tasks.filter((task) => !removeSet.has(task.id)),
        assignments: resolveSticky(snapshot.assignments.filter((assignment) => !removeSet.has(assignment.taskId)))
      });
      queuePlannerCommit(
        () =>
          api<PlannerSnapshot>('/api/tasks/delete', {
            method: 'POST',
            body: JSON.stringify({ teamId, taskIds: readyTaskIds })
          }),
        'Błąd podczas usuwania tasków.'
      );
      setSelectedIds(new Set());
    },
    [canEdit, queuePlannerCommit, snapshot, teamId, updateSnapshot]
  );

  const handleAssignmentEpicChange = useCallback(
    (epicId: string) => {
      if (!teamId || !canEdit || !snapshot || !selectedIds.size) return;
      const assignmentIds = Array.from(selectedIds);
      if (assignmentIds.some(isOptimisticId)) {
        setError(PENDING_ASSIGNMENT_MESSAGE);
        return;
      }

      const assignmentSet = new Set(assignmentIds);
      const taskIds = new Set(
        snapshot.assignments
          .filter((assignment) => assignmentSet.has(assignment.id))
          .map((assignment) => assignment.taskId)
      );
      if (!taskIds.size) return;

      updateSnapshot({
        ...snapshot,
        tasks: snapshot.tasks.map((task) => (taskIds.has(task.id) ? { ...task, epicId } : task))
      });
      setSelectionMenu(null);

      queuePlannerCommit(
        () =>
          api<PlannerSnapshot>('/api/tasks/epic', {
            method: 'POST',
            body: JSON.stringify({ teamId, assignmentIds, epicId })
          }),
        'Błąd podczas zmiany koloru.'
      );
    },
    [canEdit, queuePlannerCommit, selectedIds, snapshot, teamId, updateSnapshot]
  );

  const handleTaskEditSave = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!teamId || !canEdit || !snapshot || !taskEditDraft) return;
      if (isOptimisticId(taskEditDraft.assignmentId)) {
        setError(PENDING_ASSIGNMENT_MESSAGE);
        return;
      }
      const title = taskEditDraft.title.trim();
      if (!title) {
        setError('Wpisz nazwę taska.');
        return;
      }

      const assignment = snapshot.assignments.find((item) => item.id === taskEditDraft.assignmentId);
      if (!assignment) return;
      const previousSnapshot = snapshot;

      try {
        setError('');
        updateSnapshot({
          ...snapshot,
          tasks: snapshot.tasks.map((task) =>
            task.id === assignment.taskId
              ? {
                  ...task,
                  title,
                  status: taskEditDraft.description.trim() || undefined,
                  epicId: taskEditDraft.epicId
                }
              : task
          )
        });
        setSelectionMenu(null);

        const next = await api<PlannerSnapshot>('/api/tasks/update', {
          method: 'PATCH',
          body: JSON.stringify({
            teamId,
            assignmentId: taskEditDraft.assignmentId,
            title,
            description: taskEditDraft.description.trim() || undefined,
            epicId: taskEditDraft.epicId
          })
        });
        updateSnapshot(next);
      } catch (err) {
        updateSnapshot(previousSnapshot);
        const message = err instanceof Error ? err.message : 'Nie udało się zapisać taska.';
        setError(message);
      }
    },
    [canEdit, snapshot, taskEditDraft, teamId, updateSnapshot]
  );

  const handleResizeCommit = useCallback(
    async (assignmentId: string, durationHours?: number, durationDays?: number) => {
      if (!teamId || !canEdit) return;
      if (isOptimisticId(assignmentId)) {
        setError(PENDING_ASSIGNMENT_MESSAGE);
        return;
      }
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
      queuePlannerCommit(
        () =>
          api<PlannerSnapshot>('/api/assignments/resize', {
            method: 'POST',
            body: JSON.stringify({
              teamId,
              assignmentId,
              durationHours,
              durationDays
            })
          }),
        'Błąd podczas resize.'
      );
    },
    [canEdit, queuePlannerCommit, snapshot, teamId, updateSnapshot]
  );

  useEffect(() => {
    if (!resizing || !snapshot) return;
    const assignment = snapshot.assignments.find((item) => item.id === resizing.assignmentId);
    if (!assignment) return;

    const onMove = (event: MouseEvent) => {
      if (resizing.type === 'y') {
        const durationHours = clamp(
          resizing.startHours + Math.round((event.clientY - resizing.startY) / (HOUR_HEIGHT * plannerZoom)),
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
        resizing.startDays + Math.round((event.clientX - resizing.startX) / (dayWidth * plannerZoom)),
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
  }, [dayWidth, handleResizeCommit, plannerZoom, resizing, snapshot]);

  const handleCreateTask = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      if (!teamId || !canEdit) return;
      const title = manualTaskTitle.trim();
      const description = manualTaskDescription.trim();
      if (!title) return;
      const previousSnapshot = snapshot;
      try {
        setError('');
        if (snapshot) {
          const fallbackEpicId = manualEpicId || colorPaletteEpics[0]?.id || snapshot.epics[0]?.id;
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
                  status: description || 'todo'
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
            epicId: manualEpicId || undefined,
            description: description || undefined
          })
        });
        updateSnapshot(next);
        setManualTaskTitle('');
        setManualTaskDescription('');
        setManualEpicId('');
        setTaskComposerOpen(false);
        setSidebarCollapsed(false);
      } catch (err) {
        if (previousSnapshot) updateSnapshot(previousSnapshot);
        const message = err instanceof Error ? err.message : 'Nie udało się dodać taska.';
        setError(message);
      }
    },
    [canEdit, colorPaletteEpics, manualEpicId, manualTaskDescription, manualTaskTitle, snapshot, teamId, updateSnapshot]
  );

  const handleImportJira = useCallback(async () => {
    if (!teamId || !canImportExternal) return;
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
  }, [canImportExternal, jiraQuery, loadPlanner, teamId, timelineStartIso]);

  const handleImportExcel = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!teamId || !canImportExternal) return;
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        setExcelImporting(true);
        setError('');
        const form = new FormData();
        form.append('teamId', teamId);
        form.append('file', file);
        const result = await uploadForm<ExcelImportResult>('/api/excel/import', form);
        if (result.addedAssignments + result.updatedAssignments === 0) {
          const skipped = result.skippedEmployees.length ? ` Pominięci pracownicy: ${result.skippedEmployees.join(', ')}.` : '';
          throw new Error(`Import nie dodał bloków na osi czasu.${skipped}`);
        }
        const importWeekStart = result.firstDate ? toIsoDate(mondayOf(parseIsoDate(result.firstDate))) : focusWeekStartIso;
        const nextTimelineStart = toIsoDate(addDays(parseIsoDate(importWeekStart), -timelineLeadDays(visibleDayCount)));
        setFocusWeekStartIso(importWeekStart);
        setTimelineStartIso(nextTimelineStart);
        setPendingCenterIso(importWeekStart);
        await loadPlanner(teamId, nextTimelineStart);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Import z Excela nie powiódł się.';
        setError(message);
      } finally {
        setExcelImporting(false);
        event.target.value = '';
      }
    },
    [canImportExternal, focusWeekStartIso, loadPlanner, teamId, visibleDayCount]
  );

  const refreshTeams = useCallback(async (nextTeamId?: string) => {
    const result = await api<TeamOption[]>('/api/teams');
    setTeams(result);
    if (nextTeamId) {
      setTeamId(nextTeamId);
      return;
    }
    if (!result.some((team) => team.id === teamId)) {
      setTeamId(result[0]?.id ?? '');
      if (!result.length) setSnapshot(null);
    }
  }, [teamId]);

  const handleExportBackup = useCallback(async () => {
    if (!teamId || snapshot?.currentRole !== 'admin') return;
    try {
      setBackupWorking(true);
      setError('');
      const response = await fetch(`/api/backups/export?teamId=${encodeURIComponent(teamId)}`);
      if (!response.ok) {
        const payload = (await response.json()) as ApiResponse<unknown>;
        throw new Error(payload.ok === false ? payload.error : 'Nie udało się pobrać backupu.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `span-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nie udało się pobrać backupu.';
      setError(message);
    } finally {
      setBackupWorking(false);
    }
  }, [snapshot?.currentRole, teamId]);

  const handleRestoreBackup = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!teamId || snapshot?.currentRole !== 'admin') return;
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        setBackupWorking(true);
        setError('');
        const form = new FormData();
        form.append('teamId', teamId);
        form.append('file', file);
        const next = await uploadForm<PlannerSnapshot>('/api/backups/restore', form);
        updateSnapshot(next);
        setTeamId(next.team.id);
        await refreshTeams(next.team.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się przywrócić backupu.';
        setError(message);
      } finally {
        setBackupWorking(false);
        event.target.value = '';
      }
    },
    [refreshTeams, snapshot?.currentRole, teamId, updateSnapshot]
  );


  const loadCloudBackups = useCallback(async () => {
    if (!teamId || snapshot?.currentRole !== 'admin') return;
    try {
      setError('');
      const files = await api<CloudBackupFile[]>('/api/backups/cloud?teamId=' + encodeURIComponent(teamId));
      setCloudBackups(files);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nie udalo sie pobrac migawek z chmury.';
      setError(message);
    }
  }, [snapshot?.currentRole, teamId]);

  const handleRestoreCloudBackup = useCallback(
    async (path: string) => {
      if (!teamId || snapshot?.currentRole !== 'admin') return;
      const confirmed = window.confirm('Przywrocic te migawke? Aktualny stan kalendarza zostanie zastapiony.');
      if (!confirmed) return;
      try {
        setBackupWorking(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/backups/cloud/restore', {
          method: 'POST',
          body: JSON.stringify({ teamId, path })
        });
        updateSnapshot(next);
        setTeamId(next.team.id);
        await refreshTeams(next.team.id);
        await loadCloudBackups();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udalo sie przywrocic migawki z chmury.';
        setError(message);
      } finally {
        setBackupWorking(false);
      }
    },
    [loadCloudBackups, refreshTeams, snapshot?.currentRole, teamId, updateSnapshot]
  );

  const currentTeam = useMemo(() => teams.find((team) => team.id === teamId), [teams, teamId]);
  const currentUser = useMemo(
    () => snapshot?.users.find((user) => user.id === snapshot.currentUserId),
    [snapshot]
  );
  const canManageSettings = snapshot?.currentRole === 'admin';
  const canCreateTeams = canManageSettings || teams.length === 0;
  const canGrantAdmins = currentUser?.email?.toLowerCase() === OWNER_EMAIL;

  const handleLogout = useCallback(async () => {
    if (loggingOut) return;
    try {
      setLoggingOut(true);
      setError('');
      await plannerMutationQueueRef.current.catch(() => undefined);
      if (latestPlannerMutationErrorRef.current) {
        throw new Error('Nie wylogowuję, bo ostatni zapis nie przeszedł: ' + latestPlannerMutationErrorRef.current);
      }
      if (supabase) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) throw signOutError;
      }
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Nie udało się wylogować.');
      router.replace('/login');
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nie udało się wylogować.';
      setError(message);
      setLoggingOut(false);
    }
  }, [loggingOut, router, supabase]);

  useEffect(() => {
    if (!settingsOpen || !snapshot) return;
    setWorkspaceNameDraft(snapshot.workspace.name);
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
    setEpicDrafts(
      Object.fromEntries(
        snapshot.epics.map((epic) => [
          epic.id,
          {
            name: epic.name,
            color: epic.color
          }
        ])
      )
    );
  }, [currentTeam?.editMode, currentTeam?.name, settingsOpen, snapshot]);

  useEffect(() => {
    if (!settingsOpen || !canManageSettings || !teamId) return;
    void loadCloudBackups();
  }, [canManageSettings, loadCloudBackups, settingsOpen, teamId]);

  const handleSaveWorkspaceSettings = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!teamId || !canManageSettings || !workspaceNameDraft.trim()) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/workspace', {
          method: 'PATCH',
          body: JSON.stringify({
            teamId,
            name: workspaceNameDraft
          })
        });
        updateSnapshot(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się zapisać firmy.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, teamId, updateSnapshot, workspaceNameDraft]
  );

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
      if (!canCreateTeams || !newTeamName.trim()) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/teams/create', {
          method: 'POST',
          body: JSON.stringify({
            teamId: teamId || undefined,
            name: newTeamName,
            editMode: 'collaborative',
            workspaceName: !teamId ? newWorkspaceName || undefined : undefined
          })
        });
        updateSnapshot(next);
        setNewTeamName('');
        setNewWorkspaceName('');
        await refreshTeams(next.team.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się utworzyć teamu.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canCreateTeams, newTeamName, newWorkspaceName, refreshTeams, teamId, updateSnapshot]
  );

  const handleDeleteTeam = useCallback(async () => {
    if (!teamId || !canManageSettings || !currentTeam) return;
    const confirmed = window.confirm(`Usunąć team "${currentTeam.name}" razem z jego pracownikami i planem?`);
    if (!confirmed) return;

    try {
      setSettingsSaving(true);
      setError('');
      const result = await api<{ nextTeamId: string | null }>('/api/settings/teams/delete', {
        method: 'POST',
        body: JSON.stringify({ teamId })
      });
      setSettingsOpen(false);
      await refreshTeams(result.nextTeamId ?? undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nie udało się usunąć teamu.';
      setError(message);
    } finally {
      setSettingsSaving(false);
    }
  }, [canManageSettings, currentTeam, refreshTeams, teamId]);

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

  const handleCreateEpic = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!teamId || !canManageSettings || !newEpicName.trim()) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/epics/create', {
          method: 'POST',
          body: JSON.stringify({
            teamId,
            name: newEpicName,
            color: newEpicColor
          })
        });
        updateSnapshot(next);
        setNewEpicName('');
        setNewEpicColor('#4A7FF8');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się dodać koloru.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, newEpicColor, newEpicName, teamId, updateSnapshot]
  );

  const handleSaveEpic = useCallback(
    async (epicId: string) => {
      if (!teamId || !canManageSettings) return;
      const draft = epicDrafts[epicId];
      if (!draft) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/epics/update', {
          method: 'PATCH',
          body: JSON.stringify({
            teamId,
            epicId,
            name: draft.name,
            color: draft.color
          })
        });
        updateSnapshot(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się zapisać koloru.';
        setError(message);
      } finally {
        setSettingsSaving(false);
      }
    },
    [canManageSettings, epicDrafts, teamId, updateSnapshot]
  );

  const handleDeleteEpic = useCallback(
    async (epicId: string) => {
      if (!teamId || !canManageSettings) return;
      try {
        setSettingsSaving(true);
        setError('');
        const next = await api<PlannerSnapshot>('/api/settings/epics/delete', {
          method: 'POST',
          body: JSON.stringify({
            teamId,
            epicId
          })
        });
        updateSnapshot(next);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Nie udało się usunąć koloru.';
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
              <span className="brand-claim">SPAN pokazuje, kto ma przestrzeń i kiedy.</span>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="secondary company-switcher" type="button" onClick={() => setSettingsOpen(true)}>
              <span className="company-mark">{companyInitial(snapshot?.workspace.name)}</span>
              <span>{snapshot?.workspace.name ?? 'Firma'}</span>
            </button>
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
        </div>
        <div className="topbar-controls">
          <div className="controls-left">
            {teams.length ? (
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
            ) : (
              <button className="secondary team-select" type="button" onClick={() => setSettingsOpen(true)}>
                Brak teamu
              </button>
            )}
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
            {snapshot && (
              <>
                <span className={`role-badge role-${snapshot.currentRole}`}>{snapshot.currentRole}</span>
                <span className="mode-badge">{currentTeam?.editMode ?? snapshot.team.editMode}</span>
              </>
            )}
            <div className="week-switch" aria-label="Przełącznik tygodnia">
              <button className="secondary nav-btn" onClick={() => moveWeek(-1)} aria-label="Poprzedni tydzień">
                ‹
              </button>
              <div className="week-range mono">{weekLabel(focusWeekStartIso)}</div>
              <button className="secondary nav-btn" onClick={() => moveWeek(1)} aria-label="Następny tydzień">
                ›
              </button>
            </div>
            <div className="zoom-switch" aria-label="Zoom osi czasu">
              <button
                className="secondary zoom-btn"
                onClick={() => zoomTimeline(1)}
                disabled={plannerZoom === PLANNER_ZOOM_OPTIONS[PLANNER_ZOOM_OPTIONS.length - 1]}
                aria-label="Oddal planner"
                title="Oddal"
              >
                -
              </button>
              <div className="zoom-label mono">{Math.round(plannerZoom * 100)}%</div>
              <button
                className="secondary zoom-btn"
                onClick={() => zoomTimeline(-1)}
                disabled={plannerZoom === PLANNER_ZOOM_OPTIONS[0]}
                aria-label="Przybliż planner"
                title="Przybliż"
              >
                +
              </button>
            </div>
            <button
              className={`secondary copy-mode-btn ${copyLinkMode ? 'active' : ''}`}
              type="button"
              onClick={() => setCopyLinkMode((current) => !current)}
              title={
                copyLinkMode
                  ? 'Kopie połączone: edycja jednego taska zmieni wszystkie jego instancje.'
                  : 'Kopie osobne: wklejony task można edytować niezależnie.'
              }
            >
              Kopie: {copyLinkMode ? 'połączone' : 'osobne'}
            </button>
            <button className="secondary today-btn" onClick={goToday}>
              Dzisiaj
            </button>
          </div>
        </div>
        {!!error && <div className="error-strip">{error}</div>}
      </header>

      {selectionMenu && snapshot && canEdit && selectedAssignments.length > 0 && (
        <div
          className="selection-menu at-pointer"
          style={{ left: selectionMenu.x, top: selectionMenu.y } as CSSProperties}
          onClick={(event) => event.stopPropagation()}
        >
          {taskEditDraft && selectedAssignments.length === 1 ? (
            <form onSubmit={handleTaskEditSave}>
              <div className="selection-menu-head">
                <div>
                  <div className="selection-count mono">1 blok</div>
                  <strong>Edytuj task</strong>
                </div>
                <button
                  className="selection-clear"
                  type="button"
                  aria-label="Wyczyść zaznaczenie"
                  onClick={() => setSelectedIds(new Set())}
                >
                  ×
                </button>
              </div>
              <div className="task-edit-fields">
                <input
                  value={taskEditDraft.title}
                  onChange={(event) => setTaskEditDraft((current) => (current ? { ...current, title: event.target.value } : current))}
                  placeholder="Nazwa taska"
                />
                <textarea
                  value={taskEditDraft.description}
                  onChange={(event) =>
                    setTaskEditDraft((current) => (current ? { ...current, description: event.target.value } : current))
                  }
                  placeholder="Opis pod kafelkiem"
                  rows={3}
                />
              </div>
              <div className="selection-subtitle mono">Paleta kolorów</div>
              <div className="selection-epics">
                {colorPaletteEpics.map((epic, index) => {
                  const isActive = taskEditDraft.epicId === epic.id;
                  return (
                    <button
                      key={epic.id}
                      type="button"
                      className={`epic-choice ${isActive ? 'active' : ''}`}
                      style={{ '--epic-color': epic.color } as CSSProperties}
                      onClick={() => setTaskEditDraft((current) => (current ? { ...current, epicId: epic.id } : current))}
                      title={`Kolor ${index + 1}`}
                      aria-label={`Wybierz kolor ${index + 1}`}
                    >
                      <span className="epic-choice-dot" />
                    </button>
                  );
                })}
              </div>
              <div className="task-edit-actions">
                <button type="submit" disabled={!taskEditDraft.title.trim() || !taskEditDraft.epicId}>
                  Zapisz
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="selection-menu-head">
                <div>
                  <div className="selection-count mono">
                    {blocksLabel(selectedAssignments.length)}
                  </div>
                  <strong>Paleta kolorów</strong>
                </div>
                <button
                  className="selection-clear"
                  type="button"
                  aria-label="Wyczyść zaznaczenie"
                  onClick={() => setSelectedIds(new Set())}
                >
                  ×
                </button>
              </div>
              <div className="selection-epics">
                {colorPaletteEpics.map((epic, index) => {
                  const isActive = selectedEpicIds.size === 1 && selectedEpicIds.has(epic.id);
                  return (
                    <button
                      key={epic.id}
                      type="button"
                      className={`epic-choice ${isActive ? 'active' : ''}`}
                      style={{ '--epic-color': epic.color } as CSSProperties}
                      onClick={() => handleAssignmentEpicChange(epic.id)}
                      title={`Kolor ${index + 1}`}
                      aria-label={`Zmień na kolor ${index + 1}`}
                    >
                      <span className="epic-choice-dot" />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {!teamId || !snapshot ? (
        <main className="empty-workspace">
          <section className="empty-panel">
            <div className="mono">Czysta karta</div>
            <h1>Utwórz pierwszy team</h1>
            <p>Workspace jest pusty. Dodaj zespół, a potem pracowników i taski.</p>
            <form className="empty-create-form" onSubmit={handleCreateTeam}>
              <input
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                placeholder="Nazwa firmy"
                disabled={settingsSaving}
              />
              <input
                value={newTeamName}
                onChange={(event) => setNewTeamName(event.target.value)}
                placeholder="Nazwa teamu"
                disabled={settingsSaving}
              />
              <button type="submit" disabled={settingsSaving || !newTeamName.trim()}>
                Utwórz team
              </button>
            </form>
          </section>
        </main>
      ) : (
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
                  <div className="hint">Taski ręczne. Kolor ustawisz prawym klikiem.</div>
                </div>
                <div className="side-actions">
                  <button
                    className="secondary clear-backlog-btn"
                    onClick={() => handleDeleteTasks(backlogTasks.map((task) => task.id))}
                    disabled={!canEdit || backlogTasks.length === 0}
                    title="Usuń wszystkie taski z backlogu"
                  >
                    Wyczyść
                  </button>
                  <button
                    className="secondary collapse-btn"
                    onClick={() => setSidebarCollapsed(true)}
                    aria-label="Zwiń backlog"
                    title="Zwiń backlog"
                  >
                    ‹
                  </button>
                </div>
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
                  <textarea
                    value={manualTaskDescription}
                    onChange={(event) => setManualTaskDescription(event.target.value)}
                    disabled={!canEdit}
                    placeholder="Krótki opis pod kafelkiem"
                    maxLength={240}
                    rows={2}
                  />
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
                        setManualTaskDescription('');
                      }}
                    >
                      Anuluj
                    </button>
                  </div>
                </form>
              )}
              <div className="pool">
                {backlogTasks.map((task) => {
                  const epic = epicById.get(task.epicId);
                  const taskReady = !isOptimisticId(task.id);
                  const description = taskDescription(task);
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
                      {canEdit && taskReady && (
                        <button
                          className="delete"
                          title="Usuń z backlogu"
                          aria-label={`Usuń ${task.title} z backlogu`}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteTasks([task.id]);
                          }}
                        >
                          ×
                        </button>
                      )}
                      <span className="task-dot" />
                      <div className="task-title">{task.title}</div>
                      <div className="task-meta">
                        {taskReady ? description || '1h' : 'zapisywanie...'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </aside>

        <section className="planner-wrap" data-onboarding="timeline" ref={plannerWrapRef}>
          <div
            className="planner"
            style={
              {
                '--visible-days': String(visibleDayCount),
                '--day': `${dayWidth}px`,
                '--planner-scale': String(plannerZoom)
              } as CSSProperties
            }
          >
            <div className="grid-header" style={{ gridTemplateColumns: `var(--name) repeat(${visibleDayCount}, var(--day))` }}>
              <div className="corner">OSOBA</div>
              {visibleDays.map((date) => {
                const weekend = isWeekend(parseIsoDate(date));
                const today = toIsoDate(new Date()) === date;
                return (
                  <div key={date} className={`day-head ${weekend ? 'weekend' : ''} ${today ? 'today' : ''}`}>
                    {dateLabel(date, plannerZoom <= 0.65)}
                  </div>
                );
              })}
            </div>

            {employeesForRender.map((employee, employeeIndex) => (
              <div
                key={employee.id}
                className="person-wrap"
                style={{ '--person-tint': employee.tintColor ?? PERSON_TINTS[employeeIndex % PERSON_TINTS.length] } as CSSProperties}
              >
                <div className="person-card">
                  <div className="person-name">{employeeDisplayName(employee.name)}</div>
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
                          onMouseMove={(event) => {
                            if (!canEdit || dragContext || resizing || copiedAssignmentIdsRef.current.length === 0) return;
                            const context = buildCopiedDragContext();
                            if (!context) return;
                            const startHour = startHourFromPointer(event.clientY, event.currentTarget);
                            const target = { employeeId: employee.id, date, startHour };
                            pasteTargetRef.current = target;
                            showDropPreview(cellKey, context, target);
                          }}
                          onMouseLeave={() => {
                            if (!dragContext) clearDropPreview();
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            if (!canEdit) return;
                            const startHour = startHourFromPointer(event.clientY, event.currentTarget);
                            if (dragContext?.source === 'planner' && event.dataTransfer) {
                              event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
                            }
                            showDropPreview(cellKey, dragContext, { employeeId: employee.id, date, startHour });
                          }}
                          onDragLeave={() => {
                            clearDropPreview();
                          }}
                          onDrop={(event) => {
                            const startHour = startHourFromPointer(event.clientY, event.currentTarget);
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
                          const meta = `${pad2(assignment.startHour)}:00-${pad2(assignment.startHour + assignment.durationHours)}:00${days > 1 ? ` · ${days} dni` : ''}`;
                          const description = taskDescription(task);
                          const assignmentReady = !isOptimisticId(assignment.id);

                          return (
                            <div
                              key={assignment.id}
                              data-onboarding="multiselect"
                              className={`task planned ${days > 1 ? 'multi' : ''} ${isSelected ? 'selected' : ''} ${assignmentReady ? '' : 'pending'}`}
                              draggable={canEdit && assignmentReady}
                              onContextMenu={(event) => {
                                if (!canEdit) return;
                                event.preventDefault();
                                event.stopPropagation();
                                if (!assignmentReady) {
                                  setError(PENDING_ASSIGNMENT_MESSAGE);
                                  return;
                                }
                                if (!selectedIds.has(assignment.id)) {
                                  setSelectedIds(new Set([assignment.id]));
                                }
                                setSelectionMenu({
                                  x: Math.max(12, Math.min(event.clientX, window.innerWidth - 300)),
                                  y: Math.max(12, Math.min(event.clientY, window.innerHeight - 260))
                                });
                              }}
                              onDragStart={(event) => {
                                if (!canEdit || !assignmentReady) {
                                  event.preventDefault();
                                  return;
                                }
                                setSelectionMenu(null);
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
                                setSelectionMenu(null);
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
                              {assignmentReady && (
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
                              )}
                              <div className="task-title">{title}</div>
                              <div className="task-meta">{description || meta}</div>
                              {canEdit && assignmentReady && (
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
      )}

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
            {!canManageSettings && teams.length > 0 && (
              <div className="settings-note">Tylko admin może zmieniać teamy i pracowników.</div>
            )}
            {canManageSettings && !canGrantAdmins && (
              <div className="settings-note">Role admin może nadawać tylko {OWNER_EMAIL}.</div>
            )}
            <div className="settings-section account-settings-section">
              <div className="settings-label">Konto</div>
              <div className="account-settings-row">
                <div>
                  <div className="member-name">{currentUser?.name ?? 'Użytkownik'}</div>
                  <div className="member-email">{currentUser?.email ?? 'brak maila'}</div>
                  <div className="settings-muted">Zmiany w plannerze zapisują się automatycznie po każdej akcji.</div>
                </div>
                <button type="button" className="secondary danger-btn logout-btn" onClick={() => void handleLogout()} disabled={loggingOut}>
                  {loggingOut ? 'Wylogowuję...' : 'Wyloguj'}
                </button>
              </div>
            </div>
            <div className="settings-section">
              <div className="settings-label">Firmy i teamy</div>
              <form className="company-settings-form" onSubmit={handleSaveWorkspaceSettings}>
                <input
                  value={workspaceNameDraft}
                  onChange={(event) => setWorkspaceNameDraft(event.target.value)}
                  disabled={!canManageSettings || settingsSaving || !teamId}
                  placeholder="Nazwa firmy"
                />
                <button type="submit" disabled={!canManageSettings || settingsSaving || !workspaceNameDraft.trim() || !teamId}>
                  Zapisz
                </button>
              </form>
              <div className="settings-list">
                {teams.length ? teams.map((team) => <span key={team.id}>{team.name}</span>) : <span>Brak teamów</span>}
              </div>
            </div>
            <div className="settings-section settings-form">
              <div className="settings-label">Migawki i backup</div>
              <div className="settings-muted">
                Migawka zapisuje teamy, pracowników, taski, kolory i ułożenie kalendarza do pliku JSON.
              </div>
              <div className="settings-inline">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void handleExportBackup()}
                  disabled={!canManageSettings || backupWorking || !teamId}
                >
                  Pobierz migawkę
                </button>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={handleRestoreBackup}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => backupInputRef.current?.click()}
                  disabled={!canManageSettings || backupWorking || !teamId}
                >
                  Przywróć z pliku
                </button>
              </div>
              <div className="backup-cloud-list">
                <div className="settings-inline backup-cloud-head">
                  <span className="settings-muted">Automatyczne migawki: 12:00 i 17:00</span>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void loadCloudBackups()}
                    disabled={!canManageSettings || backupWorking || !teamId}
                  >
                    Odśwież
                  </button>
                </div>
                {cloudBackups.length ? (
                  cloudBackups.map((backup) => (
                    <div key={backup.path} className="backup-cloud-row">
                      <div>
                        <div className="member-name">{backup.name}</div>
                        <div className="member-email">{backup.path}</div>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void handleRestoreCloudBackup(backup.path)}
                        disabled={!canManageSettings || backupWorking || !teamId}
                      >
                        Przywróć
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="settings-muted">Brak zapisanych migawek w chmurze.</div>
                )}
              </div>
            </div>
            <form className="settings-section settings-form" onSubmit={handleSaveTeamSettings}>
              <div className="settings-label">Nazwa obecnie otwartego teamu</div>
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
              <button
                type="button"
                className="secondary danger-btn"
                onClick={() => void handleDeleteTeam()}
                disabled={!canManageSettings || settingsSaving}
              >
                Usuń team
              </button>
            </form>
            <form className="settings-section settings-form" onSubmit={handleCreateTeam}>
              <div className="settings-label">Nowy team</div>
              <div className="settings-inline">
                <input
                  value={newTeamName}
                  onChange={(event) => setNewTeamName(event.target.value)}
                  disabled={!canCreateTeams || settingsSaving}
                  placeholder="Nazwa nowego teamu"
                />
                <button type="submit" disabled={!canCreateTeams || settingsSaving || !newTeamName.trim()}>
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
          </section>
        </div>
      )}
    </div>
  );
}
