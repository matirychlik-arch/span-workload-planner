import { randomUUID } from 'node:crypto';
import { seedAssignments, seedEmployees, seedEpics, seedTasks, seedTeamMembers, seedTeams, seedUsers, seedWorkspace } from '@/lib/data/mock-seed';
import { resolveSticky } from '@/lib/domain/sticky';
import { Assignment, DataStore, PlannerBackup, PlannerSnapshot, Team, TeamEditMode, TeamMember, UserRole } from '@/lib/domain/types';
import { clamp, DAY_END_HOUR, DAY_START_HOUR, diffDays, MAX_DURATION_DAYS, shiftIsoDate } from '@/lib/domain/time';
import { assertCanEditTeam, assertTeamAccess } from '@/lib/security/access';
import { assertCanGrantRole, assertCanManagePeople, isOwnerEmail } from '@/lib/security/roles';
import { fetchJiraIssues } from '@/lib/integrations/jira';

type LocalState = {
  workspace: typeof seedWorkspace;
  users: typeof seedUsers;
  teams: typeof seedTeams;
  teamMembers: typeof seedTeamMembers;
  employees: typeof seedEmployees;
  epics: typeof seedEpics;
  tasks: typeof seedTasks;
  assignments: typeof seedAssignments;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizedAssignment(assignment: Assignment): Assignment {
  const next = { ...assignment };
  next.durationDays = clamp(Math.round(next.durationDays || 1), 1, MAX_DURATION_DAYS);
  next.startHour = clamp(Math.round(next.startHour || DAY_START_HOUR), DAY_START_HOUR, DAY_END_HOUR - 1);
  next.desiredStartHour = clamp(
    Math.round(next.desiredStartHour || next.startHour),
    DAY_START_HOUR,
    DAY_END_HOUR - 1
  );
  next.durationHours = clamp(Math.round(next.durationHours || 1), 1, DAY_END_HOUR - next.startHour);
  return next;
}

function touch(assignment: Assignment): Assignment {
  return {
    ...assignment,
    version: assignment.version + 1,
    updatedAt: new Date().toISOString()
  };
}

function importKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function roleTeamAndMembers(state: LocalState, teamId: string, userId: string): { team: Team; members: TeamMember[]; role: UserRole } {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) throw new Error('Nie znaleziono zespołu.');
  const members = state.teamMembers.filter((item) => item.teamId === teamId);
  const role = assertTeamAccess(members, userId);
  return { team, members, role };
}

function assertEmployeeOwnScope(state: LocalState, teamId: string, userId: string, role: UserRole, assignmentIds?: string[], targetEmployeeId?: string): void {
  if (role !== 'employee') return;
  const ownEmployeeIds = new Set(
    state.employees.filter((employee) => employee.teamId === teamId && employee.userId === userId).map((employee) => employee.id)
  );
  if (!ownEmployeeIds.size) {
    throw new Error('Brak powiązanego pracownika dla konta employee.');
  }

  if (assignmentIds?.length) {
    for (const assignmentId of assignmentIds) {
      const assignment = state.assignments.find((item) => item.id === assignmentId && item.teamId === teamId);
      if (!assignment || !ownEmployeeIds.has(assignment.employeeId)) {
        throw new Error('Employee może edytować tylko własne bloki.');
      }
    }
  }
  if (targetEmployeeId && !ownEmployeeIds.has(targetEmployeeId)) {
    throw new Error('Employee nie może planować zadań dla innych osób.');
  }
}

function applyStickyForTeam(state: LocalState, teamId: string, pinnedAssignmentId?: string): void {
  const teamAssignments = state.assignments.filter((item) => item.teamId === teamId).map(normalizedAssignment);
  const resolved = resolveSticky(teamAssignments, pinnedAssignmentId);
  const resolvedMap = new Map(resolved.map((item) => [item.id, item]));

  state.assignments = state.assignments.map((assignment) => {
    if (assignment.teamId !== teamId) return assignment;
    const next = resolvedMap.get(assignment.id);
    if (!next) return assignment;
    return touch({
      ...assignment,
      employeeId: next.employeeId,
      startDate: next.startDate,
      startHour: next.startHour,
      desiredStartHour: next.desiredStartHour,
      durationHours: next.durationHours,
      durationDays: next.durationDays
    });
  });
}

function snapshotForTeam(state: LocalState, teamId: string, userId: string): PlannerSnapshot {
  const { team, members, role } = roleTeamAndMembers(state, teamId, userId);
  const canEdit = role === 'admin' || role === 'pm' || (role === 'employee' && team.editMode === 'collaborative');
  const employeeIds = new Set(state.employees.filter((item) => item.teamId === teamId && item.active).map((item) => item.id));
  return {
    workspace: clone(state.workspace),
    team: clone(team),
    members: clone(members),
    users: clone(state.users),
    employees: clone(state.employees.filter((item) => item.teamId === teamId && item.active)),
    tasks: clone(state.tasks.filter((task) => task.workspaceId === state.workspace.id && (!task.teamId || task.teamId === teamId))),
    epics: clone(state.epics.filter((epic) => epic.workspaceId === state.workspace.id && (!epic.teamId || epic.teamId === teamId))),
    assignments: clone(state.assignments.filter((assignment) => assignment.teamId === teamId && employeeIds.has(assignment.employeeId))),
    currentUserId: userId,
    currentRole: role,
    canEdit
  };
}

function userEmail(state: LocalState, userId: string): string | undefined {
  return state.users.find((user) => user.id === userId)?.email;
}

export class LocalStore implements DataStore {
  private state: LocalState;

  constructor() {
    this.state = {
      workspace: clone(seedWorkspace),
      users: clone(seedUsers),
      teams: clone(seedTeams),
      teamMembers: clone(seedTeamMembers),
      employees: clone(seedEmployees),
      epics: clone(seedEpics),
      tasks: clone(seedTasks),
      assignments: clone(seedAssignments)
    };
  }

  async listTeamsForUser(userId: string): Promise<Array<Team & { role: UserRole }>> {
    const memberTeamIds = this.state.teamMembers.filter((item) => item.userId === userId).map((item) => item.teamId);
    return this.state.teams
      .filter((team) => memberTeamIds.includes(team.id))
      .map((team) => {
        const role = this.state.teamMembers.find((item) => item.teamId === team.id && item.userId === userId)?.role;
        return {
          ...clone(team),
          role: role ?? 'employee'
        };
      });
  }

  async getPlannerSnapshot(params: { teamId: string; userId: string; from: string; to: string }): Promise<PlannerSnapshot> {
    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async moveAssignments(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
    anchorAssignmentId: string;
    targetEmployeeId: string;
    targetDate: string;
    targetStartHour: number;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    assertEmployeeOwnScope(this.state, params.teamId, params.userId, role, params.assignmentIds, params.targetEmployeeId);

    const teamAssignments = this.state.assignments.filter((assignment) => assignment.teamId === params.teamId);
    const selected = teamAssignments.filter((assignment) => params.assignmentIds.includes(assignment.id));
    const anchorOriginal = selected.find((assignment) => assignment.id === params.anchorAssignmentId);
    if (!anchorOriginal) throw new Error('Nie znaleziono zadania kotwiczącego.');

    const dayDelta = diffDays(anchorOriginal.startDate, params.targetDate);
    const hourDelta = params.targetStartHour - anchorOriginal.startHour;
    const now = new Date().toISOString();

    this.state.assignments = this.state.assignments.map((assignment) => {
      if (!params.assignmentIds.includes(assignment.id)) return assignment;
      const original = selected.find((item) => item.id === assignment.id);
      if (!original) return assignment;
      return normalizedAssignment({
        ...assignment,
        employeeId: params.targetEmployeeId,
        startDate: shiftIsoDate(original.startDate, dayDelta),
        startHour: original.startHour + hourDelta,
        desiredStartHour: original.startHour + hourDelta,
        version: assignment.version + 1,
        updatedAt: now
      });
    });

    applyStickyForTeam(this.state, params.teamId, params.anchorAssignmentId);
    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async createAssignment(params: {
    teamId: string;
    userId: string;
    taskId: string;
    employeeId: string;
    startDate: string;
    startHour: number;
    durationHours?: number;
    durationDays?: number;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    assertEmployeeOwnScope(this.state, params.teamId, params.userId, role, undefined, params.employeeId);

    const existsTask = this.state.tasks.some((task) => task.id === params.taskId);
    if (!existsTask) throw new Error('Nie znaleziono taska do zaplanowania.');

    const now = new Date().toISOString();
    const created = normalizedAssignment({
      id: `asn-${randomUUID()}`,
      workspaceId: this.state.workspace.id,
      teamId: params.teamId,
      taskId: params.taskId,
      employeeId: params.employeeId,
      startDate: params.startDate,
      startHour: params.startHour,
      desiredStartHour: params.startHour,
      durationHours: params.durationHours ?? 1,
      durationDays: params.durationDays ?? 1,
      version: 1,
      updatedAt: now
    });

    this.state.assignments.push(created);
    applyStickyForTeam(this.state, params.teamId, created.id);
    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async createManualTask(params: {
    teamId: string;
    userId: string;
    title: string;
    epicId?: string;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);

    const title = params.title.trim();
    if (!title) throw new Error('Wpisz nazwę taska.');

    let epicId = params.epicId && this.state.epics.some((epic) => epic.id === params.epicId && (!epic.teamId || epic.teamId === params.teamId))
      ? params.epicId
      : this.state.epics.find((epic) => epic.workspaceId === this.state.workspace.id && (!epic.teamId || epic.teamId === params.teamId))?.id;

    if (!epicId) {
      epicId = `ep-${randomUUID()}`;
      this.state.epics.push({
        id: epicId,
        workspaceId: this.state.workspace.id,
        teamId: params.teamId,
        name: 'Manual',
        color: '#4A7FF8'
      });
    }

    this.state.tasks.push({
      id: `task-${randomUUID()}`,
      workspaceId: this.state.workspace.id,
      teamId: params.teamId,
      source: 'manual',
      title,
      epicId,
      status: 'todo'
    });

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async updateTeamSettings(params: {
    teamId: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
  }): Promise<PlannerSnapshot> {
    const { role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    const name = params.name.trim();
    if (!name) throw new Error('Wpisz nazwę teamu.');

    this.state.teams = this.state.teams.map((team) =>
      team.id === params.teamId
        ? {
            ...team,
            name,
            editMode: params.editMode
          }
        : team
    );

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async createTeam(params: {
    teamId?: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
    workspaceName?: string;
  }): Promise<PlannerSnapshot> {
    const context = params.teamId ? roleTeamAndMembers(this.state, params.teamId, params.userId) : null;
    const role: UserRole = context?.role ?? (isOwnerEmail(userEmail(this.state, params.userId)) ? 'admin' : 'employee');
    const workspaceId = context?.team.workspaceId ?? this.state.workspace.id;
    assertCanManagePeople(role);
    const name = params.name.trim();
    if (!name) throw new Error('Wpisz nazwę teamu.');
    const workspaceName = params.workspaceName?.trim();
    if (workspaceName) {
      this.state.workspace = {
        ...this.state.workspace,
        name: workspaceName
      };
    }

    const newTeamId = `team-${randomUUID()}`;
    this.state.teams.push({
      id: newTeamId,
      workspaceId,
      name,
      pmUserId: params.userId,
      editMode: params.editMode
    });
    this.state.teamMembers.push({
      teamId: newTeamId,
      userId: params.userId,
      role
    });

    return snapshotForTeam(this.state, newTeamId, params.userId);
  }

  async updateWorkspaceSettings(params: {
    teamId: string;
    userId: string;
    name: string;
  }): Promise<PlannerSnapshot> {
    const { role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    const name = params.name.trim();
    if (!name) throw new Error('Wpisz nazwę firmy.');

    this.state.workspace = {
      ...this.state.workspace,
      name
    };

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async deleteTeam(params: { teamId: string; userId: string }): Promise<{ nextTeamId: string | null }> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);

    const workspaceTeams = this.state.teams.filter((item) => item.workspaceId === team.workspaceId);
    const nextTeam = workspaceTeams.find((item) => item.id !== params.teamId);

    const employeeIds = new Set(
      this.state.employees.filter((employee) => employee.teamId === params.teamId).map((employee) => employee.id)
    );
    this.state.assignments = this.state.assignments.filter((assignment) => assignment.teamId !== params.teamId);
    this.state.employees = this.state.employees.filter((employee) => employee.teamId !== params.teamId);
    this.state.teamMembers = this.state.teamMembers.filter((member) => member.teamId !== params.teamId);
    this.state.teams = this.state.teams.filter((item) => item.id !== params.teamId);
    this.state.tasks = this.state.tasks.map((task) =>
      task.assigneeId && employeeIds.has(task.assigneeId)
        ? {
            ...task,
            assigneeId: undefined
          }
        : task
    );

    return { nextTeamId: nextTeam?.id ?? null };
  }

  async createEmployee(params: {
    teamId: string;
    userId: string;
    name: string;
    tintColor?: string;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    const name = params.name.trim();
    if (!name) throw new Error('Wpisz imię pracownika.');

    this.state.employees.push({
      id: `emp-${randomUUID()}`,
      workspaceId: team.workspaceId,
      teamId: params.teamId,
      name,
      active: true,
      tintColor: params.tintColor || undefined
    });

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async updateEmployee(params: {
    teamId: string;
    userId: string;
    employeeId: string;
    name?: string;
    tintColor?: string;
    active?: boolean;
  }): Promise<PlannerSnapshot> {
    const { role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    const target = this.state.employees.find((employee) => employee.id === params.employeeId && employee.teamId === params.teamId);
    if (!target) throw new Error('Nie znaleziono pracownika.');

    const name = params.name === undefined ? target.name : params.name.trim();
    if (!name) throw new Error('Wpisz imię pracownika.');

    this.state.employees = this.state.employees.map((employee) =>
      employee.id === params.employeeId
        ? {
            ...employee,
            name,
            tintColor: params.tintColor ?? employee.tintColor,
            active: params.active ?? employee.active
          }
        : employee
    );

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async createEpic(params: {
    teamId: string;
    userId: string;
    name: string;
    color: string;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    const name = params.name.trim();
    if (!name) throw new Error('Wpisz nazwę epica.');

    this.state.epics.push({
      id: `ep-${randomUUID()}`,
      workspaceId: team.workspaceId,
      teamId: params.teamId,
      name,
      color: params.color || '#4A7FF8'
    });

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async updateEpic(params: {
    teamId: string;
    userId: string;
    epicId: string;
    name?: string;
    color?: string;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    const target = this.state.epics.find((epic) => epic.id === params.epicId && epic.workspaceId === team.workspaceId && (!epic.teamId || epic.teamId === params.teamId));
    if (!target) throw new Error('Nie znaleziono epica.');
    const name = params.name === undefined ? target.name : params.name.trim();
    if (!name) throw new Error('Wpisz nazwę epica.');

    this.state.epics = this.state.epics.map((epic) =>
      epic.id === params.epicId
        ? {
            ...epic,
            name,
            color: params.color ?? epic.color
          }
        : epic
    );

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async deleteEpic(params: {
    teamId: string;
    userId: string;
    epicId: string;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    const target = this.state.epics.find((epic) => epic.id === params.epicId && epic.workspaceId === team.workspaceId && (!epic.teamId || epic.teamId === params.teamId));
    if (!target) throw new Error('Nie znaleziono epica.');

    let fallback = this.state.epics.find((epic) => epic.workspaceId === team.workspaceId && (!epic.teamId || epic.teamId === params.teamId) && epic.id !== params.epicId);
    if (!fallback) {
      fallback = {
        id: `ep-${randomUUID()}`,
        workspaceId: team.workspaceId,
        teamId: params.teamId,
        name: 'Bez epica',
        color: '#9A9890'
      };
      this.state.epics.push(fallback);
    }

    this.state.tasks = this.state.tasks.map((task) =>
      task.workspaceId === team.workspaceId && (!task.teamId || task.teamId === params.teamId) && task.epicId === params.epicId
        ? { ...task, epicId: fallback.id }
        : task
    );
    this.state.epics = this.state.epics.filter((epic) => epic.id !== params.epicId);

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async updateTeamMemberRole(params: {
    teamId: string;
    userId: string;
    memberUserId: string;
    role: UserRole;
  }): Promise<PlannerSnapshot> {
    const { role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    assertCanGrantRole(userEmail(this.state, params.userId), params.role);

    const member = this.state.teamMembers.find(
      (item) => item.teamId === params.teamId && item.userId === params.memberUserId
    );
    if (!member) throw new Error('Nie znaleziono członka teamu.');

    this.state.teamMembers = this.state.teamMembers.map((item) =>
      item.teamId === params.teamId && item.userId === params.memberUserId
        ? { ...item, role: params.role }
        : item
    );

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async deleteAssignments(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    assertEmployeeOwnScope(this.state, params.teamId, params.userId, role, params.assignmentIds);

    const removeSet = new Set(params.assignmentIds);
    this.state.assignments = this.state.assignments.filter(
      (assignment) => !(assignment.teamId === params.teamId && removeSet.has(assignment.id))
    );
    applyStickyForTeam(this.state, params.teamId);
    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async updateAssignmentsEpic(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
    epicId: string;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    assertEmployeeOwnScope(this.state, params.teamId, params.userId, role, params.assignmentIds);

    const epic = this.state.epics.find((item) => item.id === params.epicId && item.workspaceId === team.workspaceId);
    if (!epic) throw new Error('Nie znaleziono epica.');

    const assignmentIdSet = new Set(params.assignmentIds);
    const taskIds = new Set(
      this.state.assignments
        .filter((assignment) => assignment.teamId === params.teamId && assignmentIdSet.has(assignment.id))
        .map((assignment) => assignment.taskId)
    );
    if (!taskIds.size) throw new Error('Nie znaleziono assignmentów.');

    this.state.tasks = this.state.tasks.map((task) =>
      task.workspaceId === team.workspaceId && taskIds.has(task.id) ? { ...task, epicId: params.epicId } : task
    );

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async updateTask(params: {
    teamId: string;
    userId: string;
    assignmentId: string;
    title: string;
    description?: string;
    epicId: string;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    assertEmployeeOwnScope(this.state, params.teamId, params.userId, role, [params.assignmentId]);

    const assignment = this.state.assignments.find((item) => item.id === params.assignmentId && item.teamId === params.teamId);
    if (!assignment) throw new Error('Nie znaleziono assignmentu.');

    const epic = this.state.epics.find((item) => item.id === params.epicId && item.workspaceId === team.workspaceId);
    if (!epic) throw new Error('Nie znaleziono epica.');

    const title = params.title.trim();
    if (!title) throw new Error('Wpisz nazwę taska.');

    this.state.tasks = this.state.tasks.map((task) =>
      task.id === assignment.taskId && task.workspaceId === team.workspaceId
        ? {
            ...task,
            title,
            status: params.description?.trim() || undefined,
            epicId: params.epicId
          }
        : task
    );

    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async resizeAssignment(params: {
    teamId: string;
    userId: string;
    assignmentId: string;
    durationHours?: number;
    durationDays?: number;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    assertEmployeeOwnScope(this.state, params.teamId, params.userId, role, [params.assignmentId]);

    const target = this.state.assignments.find((item) => item.id === params.assignmentId && item.teamId === params.teamId);
    if (!target) throw new Error('Nie znaleziono assignmentu.');

    const updated = normalizedAssignment({
      ...target,
      durationHours: params.durationHours ?? target.durationHours,
      durationDays: params.durationDays ?? target.durationDays,
      version: target.version + 1,
      updatedAt: new Date().toISOString()
    });

    this.state.assignments = this.state.assignments.map((item) => (item.id === target.id ? updated : item));
    applyStickyForTeam(this.state, params.teamId, target.id);
    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async copyAssignments(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
    anchorAssignmentId: string;
    targetEmployeeId: string;
    targetDate: string;
    targetStartHour: number;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    assertEmployeeOwnScope(this.state, params.teamId, params.userId, role, params.assignmentIds, params.targetEmployeeId);

    const teamAssignments = this.state.assignments.filter((assignment) => assignment.teamId === params.teamId);
    const selected = teamAssignments.filter((assignment) => params.assignmentIds.includes(assignment.id));
    const anchorOriginal = selected.find((assignment) => assignment.id === params.anchorAssignmentId);
    if (!anchorOriginal) throw new Error('Nie znaleziono assignmentu kotwiczącego.');

    const dayDelta = diffDays(anchorOriginal.startDate, params.targetDate);
    const hourDelta = params.targetStartHour - anchorOriginal.startHour;
    const now = new Date().toISOString();

    const copies = selected.map((original) =>
      normalizedAssignment({
        ...original,
        id: `asn-${randomUUID()}`,
        employeeId: params.targetEmployeeId,
        startDate: shiftIsoDate(original.startDate, dayDelta),
        startHour: original.startHour + hourDelta,
        desiredStartHour: original.startHour + hourDelta,
        version: 1,
        updatedAt: now
      })
    );

    this.state.assignments.push(...copies);
    applyStickyForTeam(this.state, params.teamId, copies[0]?.id);
    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async bulkMoveAssignments(params: {
    teamId: string;
    userId: string;
    moves: Array<{ assignmentId: string; employeeId: string; date: string; startHour: number }>;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    assertEmployeeOwnScope(
      this.state,
      params.teamId,
      params.userId,
      role,
      params.moves.map((move) => move.assignmentId)
    );
    params.moves.forEach((move) => {
      assertEmployeeOwnScope(this.state, params.teamId, params.userId, role, undefined, move.employeeId);
    });

    const now = new Date().toISOString();
    const byId = new Map(params.moves.map((move) => [move.assignmentId, move]));

    this.state.assignments = this.state.assignments.map((assignment) => {
      const move = byId.get(assignment.id);
      if (!move || assignment.teamId !== params.teamId) return assignment;
      return normalizedAssignment({
        ...assignment,
        employeeId: move.employeeId,
        startDate: move.date,
        startHour: move.startHour,
        desiredStartHour: move.startHour,
        version: assignment.version + 1,
        updatedAt: now
      });
    });

    applyStickyForTeam(this.state, params.teamId, params.moves[0]?.assignmentId);
    return snapshotForTeam(this.state, params.teamId, params.userId);
  }

  async importFromJira(params: { teamId: string; userId: string; jql: string }): Promise<{ addedTasks: number; addedEpics: number }> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    if (role === 'employee') {
      throw new Error('Import z Jiry jest dostępny tylko dla PM/admin.');
    }
    assertCanEditTeam(role, team.editMode);

    const issues = await fetchJiraIssues(params.jql);
    let addedTasks = 0;
    let addedEpics = 0;

    for (const issue of issues) {
      let epicId = this.state.epics.find((epic) => !epic.teamId || epic.teamId === params.teamId)?.id;
      if (issue.epic) {
        const existingEpic = this.state.epics.find(
          (epic) => epic.workspaceId === this.state.workspace.id && (!epic.teamId || epic.teamId === params.teamId) && epic.jiraKey === issue.epic?.key
        );
        if (existingEpic) {
          epicId = existingEpic.id;
        } else {
          const newEpicId = `ep-${randomUUID()}`;
          this.state.epics.push({
            id: newEpicId,
            workspaceId: this.state.workspace.id,
            teamId: params.teamId,
            jiraKey: issue.epic.key,
            name: issue.epic.name,
            color: issue.epic.color
          });
          epicId = newEpicId;
          addedEpics += 1;
        }
      }

      const exists = this.state.tasks.some(
        (task) =>
          task.workspaceId === this.state.workspace.id &&
          (!task.teamId || task.teamId === params.teamId) &&
          (task.jiraIssueId === issue.issueId || task.jiraKey === issue.key)
      );
      if (exists) continue;

      this.state.tasks.push({
        id: `task-${randomUUID()}`,
        workspaceId: this.state.workspace.id,
        teamId: params.teamId,
        source: 'jira',
        jiraIssueId: issue.issueId,
        jiraKey: issue.key,
        title: issue.title,
        url: issue.url,
        epicId: epicId ?? this.state.epics.find((epic) => !epic.teamId || epic.teamId === params.teamId)?.id ?? '',
        status: issue.status
      });
      addedTasks += 1;
    }

    return { addedTasks, addedEpics };
  }

  async importFromExcel(params: {
    teamId: string;
    userId: string;
    fileName: string;
    data: ArrayBuffer;
  }): Promise<{ addedTasks: number; addedAssignments: number; skippedRows: number; skippedEmployees: string[] }> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    if (role === 'employee') {
      throw new Error('Import z Excela jest dostępny tylko dla PM/admin.');
    }
    assertCanEditTeam(role, team.editMode);

    const { inferEpicName, parseExcelWorkload } = await import('@/lib/integrations/excel-workload');
    const employees = this.state.employees.filter((employee) => employee.teamId === params.teamId && employee.active);
    const entries = parseExcelWorkload(params.data, employees.map((employee) => employee.name));
    const employeeByImportName = new Map(employees.map((employee) => [importKey(employee.name).split(' ')[0], employee]));
    const epicByName = new Map(
      this.state.epics
        .filter((epic) => epic.workspaceId === team.workspaceId)
        .map((epic) => [importKey(epic.name), epic])
    );
    const taskByTitle = new Map(
      this.state.tasks
        .filter((task) => task.workspaceId === team.workspaceId)
        .map((task) => [importKey(task.title), task])
    );
    const existingAssignments = new Set(
      this.state.assignments
        .filter((assignment) => assignment.teamId === params.teamId)
        .map((assignment) => {
          const task = this.state.tasks.find((item) => item.id === assignment.taskId);
          return `${assignment.employeeId}|${assignment.startDate}|${importKey(task?.title ?? '')}`;
        })
    );
    const nextStartByEmployeeDate = new Map<string, number>();
    for (const assignment of this.state.assignments.filter((item) => item.teamId === params.teamId)) {
      const key = `${assignment.employeeId}|${assignment.startDate}`;
      nextStartByEmployeeDate.set(
        key,
        Math.max(nextStartByEmployeeDate.get(key) ?? DAY_START_HOUR, assignment.startHour + assignment.durationHours)
      );
    }

    let addedTasks = 0;
    let addedAssignments = 0;
    let skippedRows = 0;
    const skippedEmployees = new Set<string>();

    for (const entry of entries) {
      const employee = employeeByImportName.get(importKey(entry.employeeName).split(' ')[0]);
      if (!employee) {
        skippedEmployees.add(entry.employeeName);
        skippedRows += 1;
        continue;
      }

      const duplicateKey = `${employee.id}|${entry.date}|${importKey(entry.title)}`;
      if (existingAssignments.has(duplicateKey)) {
        skippedRows += 1;
        continue;
      }

      const epicName = inferEpicName(entry.title);
      let epic = epicByName.get(importKey(epicName));
      if (!epic) {
        epic = {
          id: `epic-${randomUUID()}`,
          workspaceId: team.workspaceId,
          teamId: params.teamId,
          name: epicName,
          color: '#4A7FF8'
        };
        this.state.epics.push(epic);
        epicByName.set(importKey(epic.name), epic);
      }

      let task = taskByTitle.get(importKey(entry.title));
      if (!task) {
        task = {
          id: `task-${randomUUID()}`,
          workspaceId: team.workspaceId,
          teamId: params.teamId,
          source: 'manual',
          title: entry.title,
          epicId: epic.id,
          status: 'todo'
        };
        this.state.tasks.push(task);
        taskByTitle.set(importKey(task.title), task);
        addedTasks += 1;
      }

      const startKey = `${employee.id}|${entry.date}`;
      const startHour = nextStartByEmployeeDate.get(startKey) ?? DAY_START_HOUR;
      if (startHour >= DAY_END_HOUR) {
        skippedRows += 1;
        continue;
      }
      const durationHours = clamp(entry.durationHours, 1, DAY_END_HOUR - startHour);
      const now = new Date().toISOString();
      this.state.assignments.push({
        id: `assignment-${randomUUID()}`,
        workspaceId: team.workspaceId,
        teamId: params.teamId,
        taskId: task.id,
        employeeId: employee.id,
        startDate: entry.date,
        startHour,
        desiredStartHour: startHour,
        durationHours,
        durationDays: 1,
        version: 1,
        updatedAt: now
      });
      existingAssignments.add(duplicateKey);
      nextStartByEmployeeDate.set(startKey, startHour + durationHours);
      addedAssignments += 1;
    }

    applyStickyForTeam(this.state, params.teamId);
    return { addedTasks, addedAssignments, skippedRows, skippedEmployees: Array.from(skippedEmployees) };
  }

  async exportPlannerBackup(params: { teamId: string; userId: string }): Promise<PlannerBackup> {
    const { role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: clone(this.state.workspace),
      teams: clone(this.state.teams),
      members: clone(this.state.teamMembers),
      users: clone(this.state.users),
      employees: clone(this.state.employees),
      epics: clone(this.state.epics),
      tasks: clone(this.state.tasks),
      assignments: clone(this.state.assignments)
    };
  }

  async restorePlannerBackup(params: { teamId: string; userId: string; backup: PlannerBackup }): Promise<PlannerSnapshot> {
    const { role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    if (!params.backup || params.backup.version !== 1 || !params.backup.teams.length) {
      throw new Error('Nieprawidłowy plik backupu.');
    }
    this.state.workspace = clone(params.backup.workspace);
    this.state.users = clone(params.backup.users);
    this.state.teams = clone(params.backup.teams);
    this.state.teamMembers = clone(params.backup.members);
    this.state.employees = clone(params.backup.employees);
    this.state.epics = clone(params.backup.epics);
    this.state.tasks = clone(params.backup.tasks);
    this.state.assignments = clone(params.backup.assignments);

    const nextTeamId = this.state.teams[0]?.id;
    if (!nextTeamId) throw new Error('Backup nie zawiera teamu.');
    if (!this.state.teamMembers.some((member) => member.teamId === nextTeamId && member.userId === params.userId)) {
      this.state.teamMembers.push({ teamId: nextTeamId, userId: params.userId, role: 'admin' });
    }
    return snapshotForTeam(this.state, nextTeamId, params.userId);
  }
}
