import { randomUUID } from 'node:crypto';
import { seedAssignments, seedEmployees, seedEpics, seedTasks, seedTeamMembers, seedTeams, seedUsers, seedWorkspace } from '@/lib/data/mock-seed';
import { resolveSticky } from '@/lib/domain/sticky';
import { Assignment, DataStore, PlannerSnapshot, Team, TeamEditMode, TeamMember, UserRole } from '@/lib/domain/types';
import { clamp, DAY_END_HOUR, DAY_START_HOUR, diffDays, MAX_DURATION_DAYS, shiftIsoDate } from '@/lib/domain/time';
import { assertCanEditTeam, assertTeamAccess } from '@/lib/security/access';
import { assertCanGrantRole, assertCanManagePeople } from '@/lib/security/roles';
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
    tasks: clone(state.tasks.filter((task) => task.workspaceId === state.workspace.id)),
    epics: clone(state.epics.filter((epic) => epic.workspaceId === state.workspace.id)),
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

    let epicId = params.epicId && this.state.epics.some((epic) => epic.id === params.epicId)
      ? params.epicId
      : this.state.epics.find((epic) => epic.workspaceId === this.state.workspace.id)?.id;

    if (!epicId) {
      epicId = `ep-${randomUUID()}`;
      this.state.epics.push({
        id: epicId,
        workspaceId: this.state.workspace.id,
        name: 'Manual',
        color: '#4A7FF8'
      });
    }

    this.state.tasks.push({
      id: `task-${randomUUID()}`,
      workspaceId: this.state.workspace.id,
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
    teamId: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
  }): Promise<PlannerSnapshot> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);
    const name = params.name.trim();
    if (!name) throw new Error('Wpisz nazwę teamu.');

    const newTeamId = `team-${randomUUID()}`;
    this.state.teams.push({
      id: newTeamId,
      workspaceId: team.workspaceId,
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

  async deleteTeam(params: { teamId: string; userId: string }): Promise<{ nextTeamId: string }> {
    const { team, role } = roleTeamAndMembers(this.state, params.teamId, params.userId);
    assertCanManagePeople(role);

    const workspaceTeams = this.state.teams.filter((item) => item.workspaceId === team.workspaceId);
    if (workspaceTeams.length <= 1) {
      throw new Error('Nie możesz usunąć ostatniego teamu w workspace.');
    }

    const nextTeam = workspaceTeams.find((item) => item.id !== params.teamId);
    if (!nextTeam) throw new Error('Nie znaleziono teamu do przełączenia.');

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

    return { nextTeamId: nextTeam.id };
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
    const target = this.state.epics.find((epic) => epic.id === params.epicId && epic.workspaceId === team.workspaceId);
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
    const target = this.state.epics.find((epic) => epic.id === params.epicId && epic.workspaceId === team.workspaceId);
    if (!target) throw new Error('Nie znaleziono epica.');

    let fallback = this.state.epics.find((epic) => epic.workspaceId === team.workspaceId && epic.id !== params.epicId);
    if (!fallback) {
      fallback = {
        id: `ep-${randomUUID()}`,
        workspaceId: team.workspaceId,
        name: 'Bez epica',
        color: '#9A9890'
      };
      this.state.epics.push(fallback);
    }

    this.state.tasks = this.state.tasks.map((task) =>
      task.workspaceId === team.workspaceId && task.epicId === params.epicId
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
      let epicId = this.state.epics[0]?.id;
      if (issue.epic) {
        const existingEpic = this.state.epics.find(
          (epic) => epic.workspaceId === this.state.workspace.id && epic.jiraKey === issue.epic?.key
        );
        if (existingEpic) {
          epicId = existingEpic.id;
        } else {
          const newEpicId = `ep-${randomUUID()}`;
          this.state.epics.push({
            id: newEpicId,
            workspaceId: this.state.workspace.id,
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
          (task.jiraIssueId === issue.issueId || task.jiraKey === issue.key)
      );
      if (exists) continue;

      this.state.tasks.push({
        id: `task-${randomUUID()}`,
        workspaceId: this.state.workspace.id,
        source: 'jira',
        jiraIssueId: issue.issueId,
        jiraKey: issue.key,
        title: issue.title,
        url: issue.url,
        epicId: epicId ?? this.state.epics[0].id,
        status: issue.status
      });
      addedTasks += 1;
    }

    return { addedTasks, addedEpics };
  }
}
