(() => {
  'use strict';

  // State
  const STORAGE_KEY = 'workload-planner-mvp-state-v1';

  const defaults = {
    palette: {
      kreatywka: '#4A7FF8',
      eventy: '#FFC757',
      branding: '#FF7648',
      seo: '#D9B7FF',
      wakacje: '#F2A65A',
      forum: '#B8ACD8',
      kariera: '#BFD0FF',
      perfo: '#FFB4A2',
      blindsim: '#BBD7B8',
    },
    people: ['Marcin', 'Mateusz'],
    tasks: [
      { id: 'MV-101', title: 'Kreatywka', category: 'kreatywka', source: 'manual' },
      { id: 'MV-102', title: 'Eventy - projekty graficzne', category: 'eventy', source: 'jira' },
      { id: 'MV-103', title: 'Branding: 1 partia', category: 'branding', source: 'jira' },
      { id: 'MV-104', title: '[seo] przygotować szablon strony', category: 'seo', source: 'manual' },
      { id: 'MV-105', title: 'Promocja WAKACJE Z VIKINGAMI', category: 'wakacje', source: 'jira' },
      { id: 'MV-106', title: '[FORUM] grafiki do forum', category: 'forum', source: 'jira' },
      { id: 'MV-107', title: 'BlindSIM - poprawki opakowania', category: 'blindsim', source: 'jira' },
    ],
    assignments: [
      { taskId: 'MV-101', person: 'Marcin', date: '2026-06-01', start: 7, hours: 1, days: 1 },
      { taskId: 'MV-102', person: 'Marcin', date: '2026-06-01', start: 8, hours: 4, days: 1 },
      { taskId: 'MV-103', person: 'Mateusz', date: '2026-06-02', start: 7, hours: 3, days: 1 },
      { taskId: 'MV-105', person: 'Mateusz', date: '2026-06-03', start: 10, hours: 4, days: 3 },
    ],
  };

  const app = {
    SYSTEM_START: '2026-06-01',
    START_HOUR: 7,
    END_HOUR: 19,
    HOUR_HEIGHT: 52,
    DAY_WIDTH: 220,
    TIMELINE_TOP: 18,
    PERSON_TINTS: ['#EEF3FF', '#F6EFE8', '#EEF7EF', '#F2EDFA', '#FCF5E8', '#EBF4F4'],
    visibleDayCount: 35,
    timelineShiftDays: 14,
    timelineEdgeThresholdDays: 3,
    weekOffset: 0,
    initializedScroll: false,
    timelineStartISO: null,
    isTimelineShifting: false,
    dragContext: null,
    resizing: null,
    selectedAssignmentIds: new Set(),
    palette: clone(defaults.palette),
    people: [...defaults.people],
    tasks: clone(defaults.tasks),
    assignments: clone(defaults.assignments),
  };

  let assignmentSeq = 0;

  function createAssignmentId() {
    assignmentSeq += 1;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `ASN-${crypto.randomUUID()}`;
    }
    return `ASN-${Date.now().toString(36)}-${assignmentSeq.toString(36)}`;
  }

  function ensureAssignmentId(assignment) {
    if (!assignment.id) assignment.id = createAssignmentId();
    if (!Number.isFinite(Number(assignment.desiredStart))) {
      assignment.desiredStart = Number(assignment.start) || app.START_HOUR;
    }
    return assignment;
  }

  function normalizeAssignments() {
    app.assignments.forEach(ensureAssignmentId);
    pruneSelection();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function snapshot() {
    return {
      palette: app.palette,
      people: app.people,
      tasks: app.tasks,
      assignments: app.assignments,
      weekOffset: app.weekOffset,
      timelineStartISO: app.timelineStartISO,
      sidebarCollapsed: document.body.classList.contains('sidebar-collapsed'),
    };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    } catch {
      // Prototyp nie blokuje pracy, gdy przeglądarka odetnie storage.
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);
      if (saved && typeof saved.palette === 'object' && !Array.isArray(saved.palette)) {
        app.palette = { ...defaults.palette, ...saved.palette };
      }
      if (Array.isArray(saved.people)) app.people = saved.people;
      if (Array.isArray(saved.tasks)) app.tasks = saved.tasks;
      if (Array.isArray(saved.assignments)) app.assignments = saved.assignments;
      if (Number.isInteger(saved.weekOffset)) app.weekOffset = saved.weekOffset;
      if (typeof saved.timelineStartISO === 'string') app.timelineStartISO = saved.timelineStartISO;
      if (saved.sidebarCollapsed) document.body.classList.add('sidebar-collapsed');
      normalizeAssignments();
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  // Date utils
  const hpd = () => app.END_HOUR - app.START_HOUR;
  const pad2 = (value) => String(value).padStart(2, '0');
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function parseISO(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function addDays(date, amount) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + amount);
    return copy;
  }

  function mondayOf(date) {
    const copy = new Date(date);
    copy.setHours(12, 0, 0, 0);
    const day = copy.getDay() || 7;
    copy.setDate(copy.getDate() - day + 1);
    return copy;
  }

  function toISO(date) {
    const copy = new Date(date);
    copy.setHours(12, 0, 0, 0);
    return copy.toISOString().slice(0, 10);
  }

  function diff(startISO, endISO) {
    return Math.round((parseISO(endISO) - parseISO(startISO)) / 86400000);
  }

  function startWeek() {
    const todayDate = new Date();
    todayDate.setHours(12, 0, 0, 0);
    const monday = mondayOf(todayDate);
    monday.setDate(monday.getDate() + app.weekOffset * 7);
    return monday;
  }

  function weekOffsetForDate(date) {
    const todayDate = new Date();
    todayDate.setHours(12, 0, 0, 0);
    const baseMonday = mondayOf(todayDate);
    const targetMonday = mondayOf(date);
    const deltaDays = Math.round((targetMonday - baseMonday) / 86400000);
    return Math.round(deltaDays / 7);
  }

  function timelineLeadDays() {
    return Math.max(1, Math.floor((app.visibleDayCount - 7) / 2) + 1);
  }

  function defaultTimelineStartISO() {
    return toISO(addDays(startWeek(), -timelineLeadDays()));
  }

  function ensureTimelineStartISO() {
    if (!app.timelineStartISO) {
      app.timelineStartISO = defaultTimelineStartISO();
      return;
    }
    const parsed = parseISO(app.timelineStartISO);
    const day = parsed.getDay() || 7;
    if (day !== 1) app.timelineStartISO = toISO(addDays(parsed, -(day - 1)));
  }

  function recenterTimelineAroundWeek(weekStartDate) {
    app.timelineStartISO = toISO(addDays(weekStartDate, -timelineLeadDays()));
  }

  function visibleDays() {
    ensureTimelineStartISO();
    const start = parseISO(app.timelineStartISO);
    return Array.from({ length: app.visibleDayCount }, (_, index) => addDays(start, index));
  }

  function formatDay(date) {
    return date.toLocaleDateString('pl-PL', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
  }

  function weekend(date) {
    return [0, 6].includes(date.getDay());
  }

  function isToday(date) {
    return toISO(date) === toISO(new Date());
  }

  function renderWeekRange() {
    const label = document.getElementById('weekRangeLabel');
    if (!label) return;

    const weekStart = startWeek();
    const weekEnd = addDays(weekStart, 6);
    const startText = weekStart.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    const endText = weekEnd.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    label.textContent = `${startText} - ${endText}`;
  }

  // Data helpers
  function esc(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function taskById(id) {
    return app.tasks.find((task) => task.id === id);
  }

  function assignmentById(id) {
    return app.assignments.find((assignment) => assignment.id === id);
  }

  function pruneSelection() {
    const validIds = new Set(app.assignments.map((assignment) => assignment.id));
    [...app.selectedAssignmentIds].forEach((id) => {
      if (!validIds.has(id)) app.selectedAssignmentIds.delete(id);
    });
  }

  function clearSelection() {
    app.selectedAssignmentIds.clear();
  }

  function selectOnlyAssignment(id) {
    app.selectedAssignmentIds.clear();
    if (id) app.selectedAssignmentIds.add(id);
  }

  function toggleAssignmentSelection(id) {
    if (app.selectedAssignmentIds.has(id)) app.selectedAssignmentIds.delete(id);
    else app.selectedAssignmentIds.add(id);
  }

  function isMultiSelectKey(event) {
    return Boolean(event.metaKey || event.ctrlKey);
  }

  function plannedIds() {
    return new Set(app.assignments.map((assignment) => assignment.taskId));
  }

  function endDate(assignment) {
    return toISO(addDays(parseISO(assignment.date), (assignment.days || 1) - 1));
  }

  function covers(assignment, date) {
    return diff(assignment.date, date) >= 0 && diff(date, endDate(assignment)) >= 0;
  }

  function dayItems(person, date) {
    return app.assignments
      .filter((assignment) => assignment.person === person && covers(assignment, date))
      .sort((a, b) => a.start - b.start || a.taskId.localeCompare(b.taskId) || a.id.localeCompare(b.id));
  }

  function trimAssignment(assignment) {
    assignment.hours = clamp(Number(assignment.hours) || 1, 1, hpd());
    assignment.days = clamp(Number(assignment.days) || 1, 1, 10);
    assignment.desiredStart = clamp(
      Number(assignment.desiredStart ?? assignment.start) || app.START_HOUR,
      app.START_HOUR,
      app.END_HOUR - 1,
    );
    assignment.start = clamp(
      Number(assignment.start ?? assignment.desiredStart) || app.START_HOUR,
      app.START_HOUR,
      app.END_HOUR - 1,
    );
    assignment.hours = Math.min(assignment.hours, app.END_HOUR - assignment.start);
  }

  function assignmentEnd(assignment) {
    return assignment.start + assignment.hours;
  }

  function dateRangesOverlap(a, b) {
    return diff(a.date, endDate(b)) >= 0 && diff(b.date, endDate(a)) >= 0;
  }

  function timeRangesOverlap(a, b) {
    return a.start < assignmentEnd(b) && b.start < assignmentEnd(a);
  }

  function assignmentsOverlap(a, b) {
    return a.person === b.person && dateRangesOverlap(a, b) && timeRangesOverlap(a, b);
  }

  function assignmentSort(a, b) {
    return (
      a.start - b.start
      || (a.days || 1) - (b.days || 1)
      || a.date.localeCompare(b.date)
      || a.taskId.localeCompare(b.taskId)
      || a.id.localeCompare(b.id)
    );
  }

  function pushAfter(candidate, blockers) {
    const nextStart = Math.max(...blockers.map(assignmentEnd));
    candidate.start = Math.min(nextStart, app.END_HOUR - 1);
    candidate.hours = Math.max(1, Math.min(candidate.hours, app.END_HOUR - candidate.start));
  }

  function resolvePerson(person, pinned = null) {
    const assignments = app.assignments.filter((assignment) => assignment.person === person);
    assignments.forEach(trimAssignment);

    const ordered = pinned && assignments.includes(pinned)
      ? [pinned, ...assignments.filter((assignment) => assignment !== pinned).sort(assignmentSort)]
      : [...assignments].sort(assignmentSort);

    const placed = [];
    ordered.forEach((candidate) => {
      candidate.start = clamp(
        Number(candidate.desiredStart ?? candidate.start) || app.START_HOUR,
        app.START_HOUR,
        app.END_HOUR - 1,
      );
      candidate.hours = Math.max(1, Math.min(candidate.hours, app.END_HOUR - candidate.start));

      let guard = 0;
      let blockers = placed.filter((assignment) => assignmentsOverlap(candidate, assignment));

      while (blockers.length && guard < ordered.length + 2) {
        pushAfter(candidate, blockers);
        blockers = placed.filter((assignment) => assignmentsOverlap(candidate, assignment));
        guard += 1;
      }

      placed.push(candidate);
    });
  }

  function resolveAllPeople() {
    app.people.forEach((person) => resolvePerson(person));
  }

  function shiftIsoDate(iso, dayDelta) {
    const shifted = addDays(parseISO(iso), dayDelta);
    return toISO(shifted);
  }

  function cloneForDrag(assignment) {
    return {
      id: assignment.id,
      taskId: assignment.taskId,
      person: assignment.person,
      date: assignment.date,
      start: assignment.start,
      desiredStart: assignment.desiredStart,
      hours: assignment.hours,
      days: assignment.days,
    };
  }

  function plannerDragContext(anchorAssignment, event) {
    const useSelection = app.selectedAssignmentIds.has(anchorAssignment.id) && app.selectedAssignmentIds.size > 1;
    if (!useSelection) selectOnlyAssignment(anchorAssignment.id);

    const assignmentIds = useSelection
      ? Array.from(app.selectedAssignmentIds)
      : [anchorAssignment.id];

    return {
      source: 'planner',
      anchorAssignmentId: anchorAssignment.id,
      assignmentIds,
      originals: assignmentIds
        .map((id) => assignmentById(id))
        .filter(Boolean)
        .map(cloneForDrag),
    };
  }

  function applyPlannerDrop(context, target) {
    const anchorOriginal = context.originals.find((item) => item.id === context.anchorAssignmentId);
    if (!anchorOriginal) return;

    const dayDelta = diff(anchorOriginal.date, target.date);
    const hourDelta = target.start - anchorOriginal.start;
    const destinationPerson = target.person;

    let movedAssignments = [];

    if (target.copyMode) {
      movedAssignments = context.originals.map((original) => {
        const copied = {
          id: createAssignmentId(),
          taskId: original.taskId,
          person: destinationPerson,
          date: shiftIsoDate(original.date, dayDelta),
          start: original.start + hourDelta,
          desiredStart: original.start + hourDelta,
          hours: original.hours,
          days: original.days,
        };
        trimAssignment(copied);
        return copied;
      });
      app.assignments.push(...movedAssignments);
    } else {
      movedAssignments = context.assignmentIds
        .map((id) => assignmentById(id))
        .filter(Boolean);

      movedAssignments.forEach((assignment) => {
        const original = context.originals.find((item) => item.id === assignment.id);
        if (!original) return;
        assignment.person = destinationPerson;
        assignment.date = shiftIsoDate(original.date, dayDelta);
        assignment.start = original.start + hourDelta;
        assignment.desiredStart = original.start + hourDelta;
        trimAssignment(assignment);
      });
    }

    if (!movedAssignments.length) return;

    resolvePerson(destinationPerson, movedAssignments[0]);
    if (target.copyMode) {
      clearSelection();
      movedAssignments.forEach((assignment) => app.selectedAssignmentIds.add(assignment.id));
    }
  }

  function clearDropCellPreview(cell) {
    cell.classList.remove('over-slot');
    cell.querySelectorAll('.drop-preview').forEach((preview) => preview.remove());
  }

  function clearAllDropPreviews() {
    document.querySelectorAll('.day-cell.over, .day-cell.over-slot').forEach((cell) => {
      cell.classList.remove('over');
      clearDropCellPreview(cell);
    });
  }

  function dropPreviewItems(context, target) {
    if (!context) return [];

    if (context.source === 'backlog') {
      const task = taskById(context.taskId);
      return [{
        person: target.person,
        date: target.date,
        start: target.start,
        hours: 1,
        days: 1,
        color: app.palette[task?.category] || '#4A7FF8',
      }];
    }

    const anchorOriginal = context.originals.find((item) => item.id === context.anchorAssignmentId);
    if (!anchorOriginal) return [];

    const dayDelta = diff(anchorOriginal.date, target.date);
    const hourDelta = target.start - anchorOriginal.start;

    return context.originals.flatMap((original) => {
      const task = taskById(original.taskId);
      const date = shiftIsoDate(original.date, dayDelta);
      const start = clamp(original.start + hourDelta, app.START_HOUR, app.END_HOUR - 1);
      const hours = clamp(original.hours, 1, app.END_HOUR - start);
      const days = clamp(original.days || 1, 1, 10);

      return Array.from({ length: days }, (_, index) => ({
        person: target.person,
        date: toISO(addDays(parseISO(date), index)),
        start,
        hours,
        days,
        color: app.palette[task?.category] || '#4A7FF8',
      }));
    });
  }

  function renderDropPreview(context, target) {
    clearAllDropPreviews();

    dropPreviewItems(context, target).forEach((item) => {
      document.querySelectorAll(`.day-cell[data-date="${item.date}"]`).forEach((cell) => {
        if (cell.dataset.person !== item.person) return;

        const preview = document.createElement('div');
        preview.className = 'drop-preview';
        preview.style.setProperty('--preview-color', item.color);
        preview.style.top = `${app.TIMELINE_TOP + (item.start - app.START_HOUR) * app.HOUR_HEIGHT + 3}px`;
        preview.style.height = `${item.hours * app.HOUR_HEIGHT - 5}px`;
        cell.classList.add('over-slot');
        cell.appendChild(preview);
      });
    });
  }

  // Rendering
  function taskEl(task, planned = false, assignment = null, dayOffset = 0) {
    const hours = assignment ? assignment.hours : 1;
    const days = assignment ? assignment.days || 1 : 1;
    const el = document.createElement('div');
    const taskColor = app.palette[task.category] || '#DDDDDD';
    const isSelected = planned && assignment && app.selectedAssignmentIds.has(assignment.id);

    el.className = `task${planned ? ' planned' : ''}${planned && days > 1 ? ' multi' : ''}${isSelected ? ' selected' : ''}`;
    el.draggable = true;
    el.dataset.taskId = task.id;
    if (planned && assignment) el.dataset.assignmentId = assignment.id;
    el.style.setProperty('--task-color', taskColor);

    if (planned) {
      el.style.height = `${hours * app.HOUR_HEIGHT - 5}px`;
      el.style.top = `${app.TIMELINE_TOP + (assignment.start - app.START_HOUR) * app.HOUR_HEIGHT + 3}px`;
      if (dayOffset === 0 && days > 1) {
        el.style.width = `calc(${days * 100}% - 8px)`;
      }
    }

    const timeRange = planned
      ? ` · ${pad2(assignment.start)}:00-${pad2(assignment.start + hours)}:00${days > 1 ? ` · ${days} dni` : ''}`
      : '';

    el.innerHTML = `
      <button class="delete" title="Usuń">×</button>
      ${planned ? '' : '<span class="task-dot"></span>'}
      <div class="task-title">${esc(task.title)}</div>
      <div class="task-meta">${esc(task.id)} · ${hours}h${timeRange} · ${esc(task.category)}</div>
      ${planned ? '<div class="handle-y"></div><div class="handle-x"></div>' : ''}
    `;

    el.addEventListener('dragstart', (event) => {
      if (planned && assignment) {
        app.dragContext = plannerDragContext(assignment, event);
      } else {
        app.dragContext = {
          source: 'backlog',
          taskId: task.id,
        };
      }
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'copyMove';
        event.dataTransfer.setData('text/plain', planned ? `assignment:${assignment.id}` : `task:${task.id}`);
      }
    });

    el.addEventListener('dragend', () => {
      app.dragContext = null;
      clearAllDropPreviews();
    });

    if (planned && assignment) {
      el.addEventListener('click', (event) => {
        if (
          event.target.closest('.delete')
          || event.target.closest('.handle-y')
          || event.target.closest('.handle-x')
        ) {
          return;
        }

        if (isMultiSelectKey(event)) toggleAssignmentSelection(assignment.id);
        else selectOnlyAssignment(assignment.id);

        render({ plannerOnly: true, persist: false });
      });
    }

    el.querySelector('.delete').onclick = (event) => {
      event.stopPropagation();
      if (planned) {
        const idsToDelete = app.selectedAssignmentIds.has(assignment.id)
          ? new Set(app.selectedAssignmentIds)
          : new Set([assignment.id]);
        app.assignments = app.assignments.filter((item) => !idsToDelete.has(item.id));
        clearSelection();
      } else {
        app.tasks = app.tasks.filter((item) => item.id !== task.id);
        app.assignments = app.assignments.filter((item) => item.taskId !== task.id);
        pruneSelection();
      }
      render();
    };

    const handleY = el.querySelector('.handle-y');
    if (handleY) {
      handleY.onmousedown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectOnlyAssignment(assignment.id);
        app.resizing = {
          type: 'y',
          assignmentId: assignment.id,
          startY: event.clientY,
          startHours: assignment.hours,
        };
      };
    }

    const handleX = el.querySelector('.handle-x');
    if (handleX) {
      handleX.onmousedown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        selectOnlyAssignment(assignment.id);
        app.resizing = {
          type: 'x',
          assignmentId: assignment.id,
          startX: event.clientX,
          startDays: assignment.days || 1,
        };
      };
    }

    return el;
  }

  function renderEmployees() {
    const list = document.getElementById('employeeList');
    list.innerHTML = '';

    app.people.forEach((person) => {
      const row = document.createElement('div');
      row.className = 'inline';
      row.innerHTML = `
        <span style="flex:1;font-weight:700">${esc(person)}</span>
        <button class="danger tiny">Usuń</button>
      `;
      row.querySelector('button').onclick = () => {
        app.people = app.people.filter((item) => item !== person);
        app.assignments = app.assignments.filter((item) => item.person !== person);
        pruneSelection();
        render();
      };
      list.appendChild(row);
    });
  }

  function renderLegend() {
    const legend = document.getElementById('legend');
    const select = document.getElementById('manualTaskCategory');
    legend.innerHTML = '';
    select.innerHTML = '';

    Object.entries(app.palette).forEach(([name, color]) => {
      const row = document.createElement('div');
      row.className = 'legend-row';
      row.innerHTML = `
        <i class="dot" style="background:${esc(color)}"></i>
        <span>${esc(name)}</span>
        <button class="danger tiny">Usuń</button>
      `;
      row.querySelector('button').onclick = () => {
        delete app.palette[name];
        const fallback = Object.keys(app.palette)[0] || 'default';
        app.tasks = app.tasks.map((task) => (task.category === name ? { ...task, category: fallback } : task));
        render();
      };
      legend.appendChild(row);

      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  }

  function renderPool() {
    const pool = document.getElementById('taskPool');
    const planned = plannedIds();
    pool.innerHTML = '';

    app.tasks
      .filter((task) => !planned.has(task.id))
      .forEach((task) => pool.appendChild(taskEl(task)));

    pool.ondragover = (event) => {
      event.preventDefault();
      if (event.dataTransfer && app.dragContext?.source === 'planner') {
        event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
      }
    };
    pool.ondrop = (event) => {
      event.preventDefault();
      const context = app.dragContext;
      if (!context || context.source !== 'planner') return;
      const ids = new Set(context.assignmentIds || []);
      app.assignments = app.assignments.filter((assignment) => !ids.has(assignment.id));
      clearSelection();
      render();
    };
  }

  function renderPlanner() {
    const planner = document.getElementById('planner');
    const dates = visibleDays();

    planner.style.setProperty('--visible-days', String(dates.length));
    planner.style.minWidth = `calc(var(--name) + ${dates.length} * var(--day))`;
    planner.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'grid-header';
    header.style.gridTemplateColumns = `var(--name) repeat(${dates.length}, var(--day))`;
    header.innerHTML = `
      <div class="corner">OSOBA</div>
      ${dates
        .map(
          (date) =>
            `<div class="day-head ${weekend(date) ? 'weekend' : ''} ${isToday(date) ? 'today' : ''}">
              ${esc(formatDay(date))}
            </div>`,
        )
        .join('')}
    `;
    planner.appendChild(header);

    app.people.forEach((person, personIndex) => {
      const wrap = document.createElement('div');
      wrap.className = 'person-wrap';
      wrap.style.gridTemplateColumns = `var(--name) ${dates.length * app.DAY_WIDTH}px`;
      wrap.style.setProperty('--person-tint', app.PERSON_TINTS[personIndex % app.PERSON_TINTS.length]);

      const personCard = document.createElement('div');
      personCard.className = 'person-card';
      personCard.innerHTML = `<div class="person-name">${esc(person)}</div>`;
      wrap.appendChild(personCard);

      const row = document.createElement('div');
      row.className = 'days-row';
      row.style.gridTemplateColumns = `repeat(${dates.length}, var(--day))`;

      dates.forEach((dateObject) => {
        const date = toISO(dateObject);
        const cell = document.createElement('div');
        cell.className = `day-cell ${weekend(dateObject) ? 'weekend' : ''}`;
        cell.dataset.person = person;
        cell.dataset.date = date;

        const scale = document.createElement('div');
        scale.className = 'scale';
        for (let hour = app.START_HOUR; hour <= app.END_HOUR; hour += 1) {
          const label = document.createElement('div');
          label.className = 'time';
          label.style.top = `${(hour - app.START_HOUR) * app.HOUR_HEIGHT}px`;
          label.textContent = `${pad2(hour)}:00`;
          scale.appendChild(label);
        }
        cell.appendChild(scale);

        const drop = document.createElement('div');
        drop.className = 'drop';
        drop.ondragover = (event) => {
          event.preventDefault();
          const y = event.clientY - drop.getBoundingClientRect().top;
          const start = clamp(
            app.START_HOUR + Math.floor(y / app.HOUR_HEIGHT),
            app.START_HOUR,
            app.END_HOUR - 1,
          );
          renderDropPreview(app.dragContext, { person, date, start });
          if (event.dataTransfer && app.dragContext?.source === 'planner') {
            event.dataTransfer.dropEffect = event.altKey ? 'copy' : 'move';
          }
          cell.classList.add('over');
        };
        drop.ondragleave = () => {
          clearAllDropPreviews();
        };
        drop.ondrop = (event) => {
          event.preventDefault();
          clearAllDropPreviews();
          const context = app.dragContext;
          if (!context) return;

          const y = event.clientY - drop.getBoundingClientRect().top;
          const start = clamp(
            app.START_HOUR + Math.floor(y / app.HOUR_HEIGHT),
            app.START_HOUR,
            app.END_HOUR - 1,
          );
          if (context.source === 'backlog') {
            const assignment = {
              id: createAssignmentId(),
              taskId: context.taskId,
              person,
              date,
              start,
              desiredStart: start,
              hours: 1,
              days: 1,
            };
            trimAssignment(assignment);
            app.assignments.push(assignment);
            resolvePerson(person, assignment);
            selectOnlyAssignment(assignment.id);
            render();
            return;
          }

          applyPlannerDrop(context, {
            person,
            date,
            start,
            copyMode: Boolean(event.altKey),
          });
          render();
        };
        cell.appendChild(drop);

        const items = dayItems(person, date);
        items.forEach((assignment) => {
          const task = taskById(assignment.taskId);
          if (!task) return;

          const offset = diff(assignment.date, date);
          if ((assignment.days || 1) > 1 && offset !== 0) return;
          cell.appendChild(taskEl(task, true, assignment, offset));
        });

        const total = items.reduce((sum, assignment) => sum + assignment.hours, 0);
        const summary = document.createElement('div');
        summary.className = `sum ${total > hpd() ? 'over' : total === hpd() ? 'ok' : ''}`;
        summary.innerHTML = `<span>SUMA</span><span>${total}h</span>`;
        cell.appendChild(summary);
        row.appendChild(cell);
      });

      wrap.appendChild(row);
      planner.appendChild(wrap);
    });
  }

  function centerToday() {
    const wrap = document.getElementById('plannerWrap');
    const dates = visibleDays();
    const targetISO = toISO(startWeek());
    const index = Math.max(0, dates.findIndex((date) => toISO(date) === targetISO));
    wrap.scrollLeft = Math.max(0, index * app.DAY_WIDTH);
  }

  function shiftTimelineWindow(direction) {
    const wrap = document.getElementById('plannerWrap');
    if (!wrap || app.isTimelineShifting) return;
    ensureTimelineStartISO();

    const shiftDays = app.timelineShiftDays;
    const shiftPx = shiftDays * app.DAY_WIDTH;
    const currentLeft = wrap.scrollLeft;
    const currentStart = parseISO(app.timelineStartISO);
    const nextStart = addDays(currentStart, direction * shiftDays);

    app.timelineStartISO = toISO(nextStart);
    app.isTimelineShifting = true;
    render({ plannerOnly: true, persist: false });
    wrap.scrollLeft = direction > 0
      ? Math.max(0, currentLeft - shiftPx)
      : currentLeft + shiftPx;
    app.isTimelineShifting = false;
  }

  function bindTimelineScroll() {
    const wrap = document.getElementById('plannerWrap');
    if (!wrap) return;

    wrap.addEventListener('scroll', () => {
      if (app.isTimelineShifting) return;
      const threshold = app.timelineEdgeThresholdDays * app.DAY_WIDTH;
      const maxLeft = Math.max(0, wrap.scrollWidth - wrap.clientWidth);

      if (wrap.scrollLeft < threshold) {
        shiftTimelineWindow(-1);
        return;
      }
      if (maxLeft - wrap.scrollLeft < threshold) {
        shiftTimelineWindow(1);
      }
    });
  }

  function syncWeekOffsetToViewport() {
    const wrap = document.getElementById('plannerWrap');
    ensureTimelineStartISO();
    if (!wrap) return;

    const centerDayIndex = Math.max(0, Math.floor((wrap.scrollLeft + wrap.clientWidth / 2) / app.DAY_WIDTH));
    const centerDate = addDays(parseISO(app.timelineStartISO), centerDayIndex);
    app.weekOffset = weekOffsetForDate(centerDate);
  }

  function render(options = {}) {
    const { persist = true, plannerOnly = false } = options;

    if (!plannerOnly) {
      renderEmployees();
      renderLegend();
      renderPool();
      renderWeekRange();
    }
    renderPlanner();

    if (!app.initializedScroll) {
      app.initializedScroll = true;
      setTimeout(centerToday, 60);
    }

    if (persist) saveState();
  }

  // Drag / resize
  function bindResizeEvents() {
    document.addEventListener('mousemove', (event) => {
      if (!app.resizing) return;

      const assignment = assignmentById(app.resizing.assignmentId);
      if (!assignment) return;

      if (app.resizing.type === 'y') {
        const next = clamp(
          app.resizing.startHours + Math.round((event.clientY - app.resizing.startY) / app.HOUR_HEIGHT),
          1,
          app.END_HOUR - assignment.start,
        );

        if (assignment.hours !== next) {
          assignment.hours = next;
          resolvePerson(assignment.person, assignment);
          render({ plannerOnly: true });
        }
        return;
      }

      const next = clamp(
        app.resizing.startDays + Math.round((event.clientX - app.resizing.startX) / app.DAY_WIDTH),
        1,
        10,
      );

      if ((assignment.days || 1) !== next) {
        assignment.days = next;
        resolvePerson(assignment.person, assignment);
        render({ plannerOnly: true });
      }
    });

    document.addEventListener('mouseup', () => {
      app.resizing = null;
    });
  }

  // Actions
  function addEmployee() {
    const input = document.getElementById('employeeName');
    const name = input.value.trim();
    if (!name || app.people.includes(name)) return;

    app.people.push(name);
    input.value = '';
    render();
  }

  function addCategory() {
    const nameInput = document.getElementById('categoryName');
    const colorInput = document.getElementById('categoryColor');
    const name = nameInput.value.trim().toLowerCase();
    if (!name) return;

    app.palette[name] = colorInput.value;
    nameInput.value = '';
    render();
  }

  function addTask() {
    const title = document.getElementById('manualTaskTitle');
    const category = document.getElementById('manualTaskCategory').value;
    if (!title.value.trim() || !category) return;

    app.tasks.push({
      id: `MAN-${Date.now().toString().slice(-6)}`,
      title: title.value.trim(),
      category,
      source: 'manual',
    });
    title.value = '';
    render();
  }

  function importJiraMock() {
    [
      { id: 'MV-201', title: 'ACM', category: 'kreatywka', source: 'jira' },
      { id: 'MV-202', title: 'Branding: finałowe spotkanie feedbackowe', category: 'branding', source: 'jira' },
      { id: 'MV-203', title: 'BlindSIM - poprawki opakowania', category: 'blindsim', source: 'jira' },
      { id: 'MV-204', title: 'Eventy - branding przestrzeni', category: 'eventy', source: 'jira' },
      { id: 'MV-205', title: 'Strona kariera - poprawki', category: 'kariera', source: 'jira' },
    ].forEach((task) => {
      if (!app.tasks.some((existing) => existing.id === task.id)) {
        app.tasks.push(task);
      }
    });

    render();
    alert('Zaimportowano przykładowe taski. W produkcji backend wywoła Jira REST API po JQL i zwróci taski z epicami.');
  }

  function bindActions() {
    document.getElementById('collapseSidebarBtn').onclick = () => {
      document.body.classList.add('sidebar-collapsed');
      saveState();
    };
    document.getElementById('expandSidebarBtn').onclick = () => {
      document.body.classList.remove('sidebar-collapsed');
      saveState();
    };
    document.getElementById('settingsBtn').onclick = () => document.getElementById('settingsDialog').showModal();
    document.getElementById('closeSettingsBtn').onclick = () => document.getElementById('settingsDialog').close();
    document.getElementById('addEmployeeBtn').onclick = addEmployee;
    document.getElementById('employeeName').onkeydown = (event) => {
      if (event.key === 'Enter') addEmployee();
    };
    document.getElementById('addCategoryBtn').onclick = addCategory;
    document.getElementById('categoryName').onkeydown = (event) => {
      if (event.key === 'Enter') addCategory();
    };
    document.getElementById('addManualTaskBtn').onclick = addTask;
    document.getElementById('manualTaskTitle').onkeydown = (event) => {
      if (event.key === 'Enter') addTask();
    };
    document.getElementById('quickAddBtn').onclick = () => {
      document.body.classList.remove('sidebar-collapsed');
      const input = document.getElementById('manualTaskTitle');
      input.focus();
      input.select();
    };
    document.getElementById('plannerWrap').onclick = (event) => {
      if (event.target.closest('.task.planned')) return;
      if (!app.selectedAssignmentIds.size) return;
      clearSelection();
      render({ plannerOnly: true, persist: false });
    };
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!app.selectedAssignmentIds.size) return;
      clearSelection();
      render({ plannerOnly: true, persist: false });
    });
    document.getElementById('syncBtn').onclick = importJiraMock;
    document.getElementById('prevWeekBtn').onclick = () => {
      syncWeekOffsetToViewport();
      app.weekOffset -= 1;
      recenterTimelineAroundWeek(startWeek());
      render();
      setTimeout(centerToday, 0);
    };
    document.getElementById('nextWeekBtn').onclick = () => {
      syncWeekOffsetToViewport();
      app.weekOffset += 1;
      recenterTimelineAroundWeek(startWeek());
      render();
      setTimeout(centerToday, 0);
    };
    document.getElementById('todayBtn').onclick = () => {
      app.weekOffset = 0;
      recenterTimelineAroundWeek(startWeek());
      render();
      setTimeout(centerToday, 0);
    };
  }

  loadState();
  normalizeAssignments();
  ensureTimelineStartISO();
  resolveAllPeople();
  bindActions();
  bindResizeEvents();
  bindTimelineScroll();
  render({ persist: false });
})();
