import { randomUUID } from 'node:crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { fetchJiraIssues } from '@/lib/integrations/jira';
import { resolveSticky } from '@/lib/domain/sticky';
import { Assignment, AppUser, DataStore, Employee, Epic, PlannerSnapshot, Task, Team, TeamEditMode, TeamMember, UserRole, Workspace } from '@/lib/domain/types';
import { clamp, DAY_END_HOUR, DAY_START_HOUR, diffDays, MAX_DURATION_DAYS, shiftIsoDate } from '@/lib/domain/time';
import { assertCanEditTeam, assertTeamAccess } from '@/lib/security/access';
import {
  CREATIVE_EMPLOYEES,
  CREATIVE_TEAM_NAME,
  MATEUSZ_WORK_EMAIL,
  OWNER_EMAIL,
  assertCanGrantRole,
  assertCanManagePeople,
  isOwnerEmail,
  normalizeEmail
} from '@/lib/security/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { seedAssignments, seedEpics, seedTasks, seedWorkspace } from '@/lib/data/mock-seed';

type WorkspaceRow = {
  id: string;
  name: string;
  google_auth_enabled: boolean;
  jira_connected: boolean;
  slack_connected: boolean;
};

type AppUserRow = {
  id: string;
  workspace_id: string;
  email: string;
  name: string;
  google_sub: string | null;
  slack_user_id: string | null;
};

type TeamRow = {
  id: string;
  workspace_id: string;
  name: string;
  pm_user_id: string;
  edit_mode: 'collaborative' | 'pm_only';
};

type TeamMemberRow = {
  team_id: string;
  user_id: string;
  role: UserRole;
};

type EmployeeRow = {
  id: string;
  workspace_id: string;
  team_id: string;
  user_id: string | null;
  name: string;
  active: boolean;
  tint_color: string | null;
};

type EpicRow = {
  id: string;
  workspace_id: string;
  jira_key: string | null;
  name: string;
  color: string;
};

type TaskRow = {
  id: string;
  workspace_id: string;
  source: 'jira' | 'manual';
  jira_issue_id: string | null;
  jira_key: string | null;
  title: string;
  url: string | null;
  epic_id: string;
  status: string | null;
  assignee_id: string | null;
};

type AssignmentRow = {
  id: string;
  workspace_id: string;
  team_id: string;
  task_id: string;
  employee_id: string;
  start_date: string;
  start_hour: number;
  desired_start_hour: number;
  duration_hours: number;
  duration_days: number;
  completion_ratio: number | null;
  version: number;
  updated_at: string;
};

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    googleAuthEnabled: row.google_auth_enabled,
    jiraConnected: row.jira_connected,
    slackConnected: row.slack_connected
  };
}

function toUser(row: AppUserRow): AppUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    googleSub: row.google_sub ?? undefined,
    slackUserId: row.slack_user_id ?? undefined
  };
}

function toTeam(row: TeamRow): Team {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    pmUserId: row.pm_user_id,
    editMode: row.edit_mode
  };
}

function toTeamMember(row: TeamMemberRow): TeamMember {
  return {
    teamId: row.team_id,
    userId: row.user_id,
    role: row.role
  };
}

function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    teamId: row.team_id,
    userId: row.user_id ?? undefined,
    name: row.name,
    active: row.active,
    tintColor: row.tint_color ?? undefined
  };
}

function toEpic(row: EpicRow): Epic {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    jiraKey: row.jira_key ?? undefined,
    name: row.name,
    color: row.color
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    source: row.source,
    jiraIssueId: row.jira_issue_id ?? undefined,
    jiraKey: row.jira_key ?? undefined,
    title: row.title,
    url: row.url ?? undefined,
    epicId: row.epic_id,
    status: row.status ?? undefined,
    assigneeId: row.assignee_id ?? undefined
  };
}

function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    teamId: row.team_id,
    taskId: row.task_id,
    employeeId: row.employee_id,
    startDate: row.start_date,
    startHour: row.start_hour,
    desiredStartHour: row.desired_start_hour,
    durationHours: row.duration_hours,
    durationDays: row.duration_days,
    completionRatio: row.completion_ratio ?? undefined,
    version: row.version,
    updatedAt: row.updated_at
  };
}

function toAssignmentRow(assignment: Assignment): AssignmentRow {
  return {
    id: assignment.id,
    workspace_id: assignment.workspaceId,
    team_id: assignment.teamId,
    task_id: assignment.taskId,
    employee_id: assignment.employeeId,
    start_date: assignment.startDate,
    start_hour: assignment.startHour,
    desired_start_hour: assignment.desiredStartHour,
    duration_hours: assignment.durationHours,
    duration_days: assignment.durationDays,
    completion_ratio: assignment.completionRatio ?? null,
    version: assignment.version,
    updated_at: assignment.updatedAt
  };
}

function normalizeAssignment(assignment: Assignment): Assignment {
  const normalized = { ...assignment };
  normalized.durationDays = clamp(Math.round(normalized.durationDays || 1), 1, MAX_DURATION_DAYS);
  normalized.startHour = clamp(Math.round(normalized.startHour || DAY_START_HOUR), DAY_START_HOUR, DAY_END_HOUR - 1);
  normalized.desiredStartHour = clamp(
    Math.round(normalized.desiredStartHour || normalized.startHour),
    DAY_START_HOUR,
    DAY_END_HOUR - 1
  );
  normalized.durationHours = clamp(Math.round(normalized.durationHours || 1), 1, DAY_END_HOUR - normalized.startHour);
  return normalized;
}

function touch(assignment: Assignment): Assignment {
  return {
    ...assignment,
    version: assignment.version + 1,
    updatedAt: new Date().toISOString()
  };
}

function assignmentChanged(previous: Assignment, next: Assignment): boolean {
  return (
    previous.workspaceId !== next.workspaceId ||
    previous.teamId !== next.teamId ||
    previous.taskId !== next.taskId ||
    previous.employeeId !== next.employeeId ||
    previous.startDate !== next.startDate ||
    previous.startHour !== next.startHour ||
    previous.desiredStartHour !== next.desiredStartHour ||
    previous.durationHours !== next.durationHours ||
    previous.durationDays !== next.durationDays ||
    (previous.completionRatio ?? null) !== (next.completionRatio ?? null)
  );
}

function changedAssignments(previous: Assignment[], next: Assignment[]): Assignment[] {
  const previousById = new Map(previous.map((assignment) => [assignment.id, assignment]));
  const changed: Assignment[] = [];

  for (const assignment of next) {
    const before = previousById.get(assignment.id);
    if (!before) {
      changed.push(assignment);
      continue;
    }
    if (assignmentChanged(before, assignment)) {
      changed.push(touch({ ...assignment, version: before.version, updatedAt: before.updatedAt }));
    }
  }

  return changed;
}

type TeamContext = {
  team: Team;
  members: TeamMember[];
  role: UserRole;
};

export class SupabaseStore implements DataStore {
  private client: SupabaseClient;

  constructor(client?: SupabaseClient) {
    this.client = client ?? createSupabaseAdminClient();
  }

  private async authProfile(userId: string): Promise<{ email: string; name: string; googleSub: string | null }> {
    const { data: authUser, error: authError } = await this.client.auth.admin.getUserById(userId);
    if (authError) throw new Error(authError.message);
    if (!authUser.user) throw new Error('Nie znaleziono użytkownika auth.');
    const email = normalizeEmail(authUser.user.email);
    return {
      email: email || `user-${userId}@span.local`,
      name: authUser.user.user_metadata?.name ?? email.split('@')[0] ?? 'Uzytkownik',
      googleSub: authUser.user.user_metadata?.sub ?? null
    };
  }

  private async ownerWorkspaceId(): Promise<string | null> {
    const { data, error } = await this.client
      .from('app_users')
      .select('workspace_id')
      .eq('email', OWNER_EMAIL)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.workspace_id ? String(data.workspace_id) : null;
  }

  private async ensureCreativeTeam(workspaceId: string, pmUserId: string): Promise<string> {
    const { data: teams, error: teamListError } = await this.client
      .from('teams')
      .select('id, name')
      .eq('workspace_id', workspaceId);
    if (teamListError) throw new Error(teamListError.message);

    const existingTeams = (teams ?? []) as Array<{ id: string; name: string }>;
    const existingCreative = existingTeams.find((team) => team.name === CREATIVE_TEAM_NAME);
    const reusableTeam = existingCreative ?? existingTeams[0];

    if (reusableTeam) {
      return reusableTeam.id;
    }

    const teamId = randomUUID();
    const teamRow: TeamRow = {
      id: teamId,
      workspace_id: workspaceId,
      name: CREATIVE_TEAM_NAME,
      pm_user_id: pmUserId,
      edit_mode: 'collaborative'
    };
    const { error } = await this.client.from('teams').insert(teamRow);
    if (error) throw new Error(error.message);
    return teamId;
  }

  private async ensureCreativeEmployees(workspaceId: string, teamId: string): Promise<void> {
    const { data: employees, error } = await this.client
      .from('employees')
      .select('id, name')
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);

    const existing = (employees ?? []) as Array<{ id: string; name: string }>;
    if (existing.length) return;

    for (const employee of CREATIVE_EMPLOYEES) {
      const { error: insertError } = await this.client.from('employees').insert({
        id: randomUUID(),
        workspace_id: workspaceId,
        team_id: teamId,
        user_id: null,
        name: employee.name,
        active: true,
        tint_color: employee.tintColor
      });
      if (insertError) throw new Error(insertError.message);
    }
  }

  private async detachUserFromWorkspaceEmployees(workspaceId: string, userId: string): Promise<void> {
    const { error } = await this.client
      .from('employees')
      .update({ user_id: null })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  private async detachUserFromTeamEmployees(teamId: string, userId: string): Promise<void> {
    const { error } = await this.client
      .from('employees')
      .update({ user_id: null })
      .eq('team_id', teamId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  private async ensureMember(teamId: string, userId: string, role: UserRole): Promise<void> {
    const { data: member, error } = await this.client
      .from('team_members')
      .select('team_id, user_id, role')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (member) {
      const { error: updateError } = await this.client
        .from('team_members')
        .update({ role })
        .eq('team_id', teamId)
        .eq('user_id', userId);
      if (updateError) throw new Error(updateError.message);
      return;
    }

    const { error: insertError } = await this.client.from('team_members').insert({
      team_id: teamId,
      user_id: userId,
      role
    });
    if (insertError) throw new Error(insertError.message);
  }

  private async attachMateuszWorkUser(userId: string, profile: { email: string; name: string; googleSub: string | null }): Promise<boolean> {
    if (profile.email !== MATEUSZ_WORK_EMAIL) return false;
    const workspaceId = await this.ownerWorkspaceId();
    if (!workspaceId) return false;

    const { data: ownerUser, error: ownerError } = await this.client
      .from('app_users')
      .select('id')
      .eq('email', OWNER_EMAIL)
      .maybeSingle();
    if (ownerError) throw new Error(ownerError.message);
    const ownerUserId = ownerUser?.id ? String(ownerUser.id) : userId;
    const teamId = await this.ensureCreativeTeam(workspaceId, ownerUserId);

    const userRow: AppUserRow = {
      id: userId,
      workspace_id: workspaceId,
      email: profile.email,
      name: 'Mateusz',
      google_sub: profile.googleSub,
      slack_user_id: null
    };
    const { error: userError } = await this.client.from('app_users').upsert(userRow, { onConflict: 'id' });
    if (userError) throw new Error(userError.message);

    await this.ensureMember(teamId, userId, 'employee');

    const { data: mateuszEmployee, error: employeeError } = await this.client
      .from('employees')
      .select('id')
      .eq('team_id', teamId)
      .ilike('name', '%Mateusz%')
      .limit(1)
      .maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (mateuszEmployee?.id) {
      const { error: attachError } = await this.client
        .from('employees')
        .update({ user_id: userId })
        .eq('id', mateuszEmployee.id);
      if (attachError) throw new Error(attachError.message);
    }

    return true;
  }

  private async ensureUserWorkspaceAndSeed(userId: string): Promise<void> {
    if (!userId || userId.startsWith('u-')) return;

    const profile = await this.authProfile(userId);
    const { data: existingUser, error: userError } = await this.client
      .from('app_users')
      .select('id, workspace_id, email')
      .eq('id', userId)
      .maybeSingle();
    if (userError) throw new Error(userError.message);
    if (existingUser) {
      if (isOwnerEmail(profile.email)) {
        const teamId = await this.ensureCreativeTeam(String(existingUser.workspace_id), userId);
        await this.detachUserFromWorkspaceEmployees(String(existingUser.workspace_id), userId);
        await this.ensureMember(teamId, userId, 'admin');
      } else {
        await this.attachMateuszWorkUser(userId, profile);
      }
      return;
    }

    if (await this.attachMateuszWorkUser(userId, profile)) return;

    const workspaceId = randomUUID();
    const teamId = randomUUID();
    const now = new Date().toISOString();

    const workspaceInsert: WorkspaceRow = {
      id: workspaceId,
      name: `${seedWorkspace.name} ${profile.email}`.trim(),
      google_auth_enabled: true,
      jira_connected: false,
      slack_connected: false
    };
    const { error: workspaceError } = await this.client.from('workspaces').insert(workspaceInsert);
    if (workspaceError) throw new Error(workspaceError.message);

    const userRow: AppUserRow = {
      id: userId,
      workspace_id: workspaceId,
      email: profile.email,
      name: isOwnerEmail(profile.email) ? 'Mateusz admin' : profile.name,
      google_sub: profile.googleSub,
      slack_user_id: null
    };
    const { error: appUserError } = await this.client.from('app_users').insert(userRow);
    if (appUserError) throw new Error(appUserError.message);

    const teamRow: TeamRow = {
      id: teamId,
      workspace_id: workspaceId,
      name: CREATIVE_TEAM_NAME,
      pm_user_id: userId,
      edit_mode: 'collaborative'
    };
    const { error: teamError } = await this.client.from('teams').insert(teamRow);
    if (teamError) throw new Error(teamError.message);

    const { error: memberError } = await this.client.from('team_members').insert({
      team_id: teamId,
      user_id: userId,
      role: 'admin'
    });
    if (memberError) throw new Error(memberError.message);

    const employeeRows: EmployeeRow[] = CREATIVE_EMPLOYEES.map((employee) => ({
      id: randomUUID(),
      workspace_id: workspaceId,
      team_id: teamId,
      user_id: null,
      name: employee.name,
      active: true,
      tint_color: employee.tintColor
    }));
    const { data: insertedEmployees, error: employeeError } = await this.client
      .from('employees')
      .insert(employeeRows)
      .select('*');
    if (employeeError) throw new Error(employeeError.message);
    const employees = (insertedEmployees ?? []) as EmployeeRow[];

    const epicMap = new Map<string, string>();
    const epicRows: EpicRow[] = seedEpics.map((epic) => ({
      id: randomUUID(),
      workspace_id: workspaceId,
      jira_key: epic.jiraKey ?? null,
      name: epic.name,
      color: epic.color
    }));
    const { data: insertedEpics, error: epicError } = await this.client.from('epics').insert(epicRows).select('*');
    if (epicError) throw new Error(epicError.message);
    (insertedEpics as EpicRow[]).forEach((epic) => {
      const found = seedEpics.find((item) => item.name === epic.name);
      if (found) epicMap.set(found.id, epic.id);
    });

    const taskMap = new Map<string, string>();
    const taskRows: TaskRow[] = seedTasks.map((task) => ({
      id: randomUUID(),
      workspace_id: workspaceId,
      source: task.source,
      jira_issue_id: task.jiraIssueId ?? null,
      jira_key: task.jiraKey ?? null,
      title: task.title,
      url: task.url ?? null,
      epic_id: epicMap.get(task.epicId) ?? Array.from(epicMap.values())[0],
      status: task.status ?? null,
      assignee_id: null
    }));
    const { data: insertedTasks, error: taskError } = await this.client.from('tasks').insert(taskRows).select('*');
    if (taskError) throw new Error(taskError.message);
    (insertedTasks as TaskRow[]).forEach((task) => {
      const found = seedTasks.find((item) => item.title === task.title);
      if (found) taskMap.set(found.id, task.id);
    });

    const marcinEmployee = employees.find((employee) => employee.name.toLowerCase().includes('marcin')) ?? employees[0];
    const mateuszEmployee = employees.find((employee) => employee.name.toLowerCase().includes('mateusz')) ?? employees[0];
    const assignmentRows: AssignmentRow[] = seedAssignments.map((assignment) => ({
      id: randomUUID(),
      workspace_id: workspaceId,
      team_id: teamId,
      task_id: taskMap.get(assignment.taskId) ?? Array.from(taskMap.values())[0],
      employee_id: assignment.employeeId.includes('marcin') ? marcinEmployee.id : mateuszEmployee.id,
      start_date: assignment.startDate,
      start_hour: assignment.startHour,
      desired_start_hour: assignment.desiredStartHour,
      duration_hours: assignment.durationHours,
      duration_days: assignment.durationDays,
      completion_ratio: assignment.completionRatio ?? null,
      version: 1,
      updated_at: now
    }));
    const { error: assignmentError } = await this.client.from('assignments').insert(assignmentRows);
    if (assignmentError) throw new Error(assignmentError.message);

    if (isOwnerEmail(profile.email)) {
      await this.detachUserFromTeamEmployees(teamId, userId);
    }
  }

  private async teamContext(teamId: string, userId: string): Promise<TeamContext> {
    const { data: teamData, error: teamError } = await this.client
      .from('teams')
      .select('id, workspace_id, name, pm_user_id, edit_mode')
      .eq('id', teamId)
      .maybeSingle();
    if (teamError) throw new Error(teamError.message);
    if (!teamData) throw new Error('Nie znaleziono zespołu.');

    const { data: memberData, error: memberError } = await this.client
      .from('team_members')
      .select('team_id, user_id, role')
      .eq('team_id', teamId);
    if (memberError) throw new Error(memberError.message);

    const team = toTeam(teamData as TeamRow);
    const members = (memberData as TeamMemberRow[]).map(toTeamMember);
    const role = assertTeamAccess(members, userId);
    return { team, members, role };
  }

  private async assertEmployeeOwnScope(teamId: string, userId: string, role: UserRole, assignmentIds?: string[], targetEmployeeId?: string): Promise<void> {
    if (role !== 'employee') return;

    const { data: ownEmployees, error } = await this.client
      .from('employees')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', userId)
      .eq('active', true);
    if (error) throw new Error(error.message);

    const ownEmployeeIds = new Set((ownEmployees ?? []).map((item) => String(item.id)));
    if (!ownEmployeeIds.size) {
      throw new Error('Brak powiązanego pracownika dla konta employee.');
    }

    if (assignmentIds?.length) {
      const { data: assignments, error: assignmentError } = await this.client
        .from('assignments')
        .select('id, employee_id')
        .in('id', assignmentIds)
        .eq('team_id', teamId);
      if (assignmentError) throw new Error(assignmentError.message);
      const assignmentMap = new Map((assignments ?? []).map((item) => [String(item.id), String(item.employee_id)]));
      for (const assignmentId of assignmentIds) {
        const employeeId = assignmentMap.get(assignmentId);
        if (!employeeId || !ownEmployeeIds.has(employeeId)) {
          throw new Error('Employee może edytować tylko własne bloki.');
        }
      }
    }

    if (targetEmployeeId && !ownEmployeeIds.has(targetEmployeeId)) {
      throw new Error('Employee nie może planować zadań dla innych osób.');
    }
  }

  private async loadAssignmentsForTeam(teamId: string): Promise<Assignment[]> {
    const { data, error } = await this.client
      .from('assignments')
      .select('id, workspace_id, team_id, task_id, employee_id, start_date, start_hour, desired_start_hour, duration_hours, duration_days, completion_ratio, version, updated_at')
      .eq('team_id', teamId);
    if (error) throw new Error(error.message);
    return (data as AssignmentRow[]).map(toAssignment).map(normalizeAssignment);
  }

  private async persistAssignments(assignments: Assignment[]): Promise<void> {
    if (!assignments.length) return;
    const payload = assignments.map((assignment) => toAssignmentRow(assignment));
    const { error } = await this.client
      .from('assignments')
      .upsert(payload, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  private async persistResolvedAssignments(previous: Assignment[], resolved: Assignment[]): Promise<void> {
    await this.persistAssignments(changedAssignments(previous, resolved));
  }

  private async snapshot(teamId: string, userId: string): Promise<PlannerSnapshot> {
    const { team, members, role } = await this.teamContext(teamId, userId);
    const canEdit = role === 'admin' || role === 'pm' || (role === 'employee' && team.editMode === 'collaborative');

    const [workspaceResult, usersResult, employeesResult, epicsResult, tasksResult, assignmentsResult] = await Promise.all([
      this.client.from('workspaces').select('id, name, google_auth_enabled, jira_connected, slack_connected').eq('id', team.workspaceId).single(),
      this.client.from('app_users').select('id, workspace_id, email, name, google_sub, slack_user_id').eq('workspace_id', team.workspaceId),
      this.client.from('employees').select('id, workspace_id, team_id, user_id, name, active, tint_color').eq('team_id', team.id).eq('active', true),
      this.client.from('epics').select('id, workspace_id, jira_key, name, color').eq('workspace_id', team.workspaceId),
      this.client.from('tasks').select('id, workspace_id, source, jira_issue_id, jira_key, title, url, epic_id, status, assignee_id').eq('workspace_id', team.workspaceId),
      this.client.from('assignments').select('id, workspace_id, team_id, task_id, employee_id, start_date, start_hour, desired_start_hour, duration_hours, duration_days, completion_ratio, version, updated_at').eq('team_id', team.id)
    ]);

    if (workspaceResult.error) throw new Error(workspaceResult.error.message);
    if (usersResult.error) throw new Error(usersResult.error.message);
    if (employeesResult.error) throw new Error(employeesResult.error.message);
    if (epicsResult.error) throw new Error(epicsResult.error.message);
    if (tasksResult.error) throw new Error(tasksResult.error.message);
    if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);

    const workspace = toWorkspace(workspaceResult.data as WorkspaceRow);
    const users = (usersResult.data as AppUserRow[]).map(toUser);
    const employees = (employeesResult.data as EmployeeRow[]).map(toEmployee);
    const epics = (epicsResult.data as EpicRow[]).map(toEpic);
    const tasks = (tasksResult.data as TaskRow[]).map(toTask);
    const assignments = (assignmentsResult.data as AssignmentRow[]).map(toAssignment);

    return {
      workspace,
      team,
      members,
      users,
      employees,
      tasks,
      epics,
      assignments,
      currentUserId: userId,
      currentRole: role,
      canEdit
    };
  }

  async listTeamsForUser(userId: string): Promise<Array<Team & { role: UserRole }>> {
    await this.ensureUserWorkspaceAndSeed(userId);

    const { data: memberData, error: memberError } = await this.client
      .from('team_members')
      .select('team_id, role')
      .eq('user_id', userId);
    if (memberError) throw new Error(memberError.message);

    const teamIds = (memberData ?? []).map((item) => String(item.team_id));
    if (!teamIds.length) return [];

    const { data: teamData, error: teamError } = await this.client
      .from('teams')
      .select('id, workspace_id, name, pm_user_id, edit_mode')
      .in('id', teamIds);
    if (teamError) throw new Error(teamError.message);

    const roleByTeam = new Map((memberData ?? []).map((item) => [String(item.team_id), item.role as UserRole]));
    return (teamData as TeamRow[]).map((row) => ({
      ...toTeam(row),
      role: roleByTeam.get(row.id) ?? 'employee'
    }));
  }

  async getPlannerSnapshot(params: { teamId: string; userId: string; from: string; to: string }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    return this.snapshot(params.teamId, params.userId);
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
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    await this.assertEmployeeOwnScope(params.teamId, params.userId, role, params.assignmentIds, params.targetEmployeeId);

    const allAssignments = await this.loadAssignmentsForTeam(params.teamId);
    const selected = allAssignments.filter((assignment) => params.assignmentIds.includes(assignment.id));
    const anchor = selected.find((assignment) => assignment.id === params.anchorAssignmentId);
    if (!anchor) throw new Error('Nie znaleziono zadania kotwiczacego.');

    const dayDelta = diffDays(anchor.startDate, params.targetDate);
    const hourDelta = params.targetStartHour - anchor.startHour;

    const movedIds = new Set(params.assignmentIds);
    const nextAssignments = allAssignments.map((assignment) => {
      if (!movedIds.has(assignment.id)) return assignment;
      const original = selected.find((item) => item.id === assignment.id);
      if (!original) return assignment;
      return normalizeAssignment({
        ...assignment,
        employeeId: params.targetEmployeeId,
        startDate: shiftIsoDate(original.startDate, dayDelta),
        startHour: original.startHour + hourDelta,
        desiredStartHour: original.startHour + hourDelta
      });
    });

    const resolved = resolveSticky(nextAssignments, params.anchorAssignmentId);
    await this.persistResolvedAssignments(allAssignments, resolved);
    return this.snapshot(params.teamId, params.userId);
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
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    await this.assertEmployeeOwnScope(params.teamId, params.userId, role, undefined, params.employeeId);

    const { data: task, error: taskError } = await this.client
      .from('tasks')
      .select('id, workspace_id')
      .eq('id', params.taskId)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task) throw new Error('Nie znaleziono taska do zaplanowania.');

    const created = normalizeAssignment({
      id: randomUUID(),
      workspaceId: String(task.workspace_id),
      teamId: params.teamId,
      taskId: params.taskId,
      employeeId: params.employeeId,
      startDate: params.startDate,
      startHour: params.startHour,
      desiredStartHour: params.startHour,
      durationHours: params.durationHours ?? 1,
      durationDays: params.durationDays ?? 1,
      version: 1,
      updatedAt: new Date().toISOString()
    });

    const allAssignments = await this.loadAssignmentsForTeam(params.teamId);
    const resolved = resolveSticky([...allAssignments, created], created.id);
    await this.persistResolvedAssignments(allAssignments, resolved);
    return this.snapshot(params.teamId, params.userId);
  }

  async createManualTask(params: {
    teamId: string;
    userId: string;
    title: string;
    epicId?: string;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);

    const title = params.title.trim();
    if (!title) throw new Error('Wpisz nazwę taska.');

    let epicId = params.epicId;
    if (epicId) {
      const { data: epic, error: epicError } = await this.client
        .from('epics')
        .select('id')
        .eq('id', epicId)
        .eq('workspace_id', team.workspaceId)
        .maybeSingle();
      if (epicError) throw new Error(epicError.message);
      if (!epic) epicId = undefined;
    }

    if (!epicId) {
      const { data: firstEpic, error: firstEpicError } = await this.client
        .from('epics')
        .select('id')
        .eq('workspace_id', team.workspaceId)
        .limit(1)
        .maybeSingle();
      if (firstEpicError) throw new Error(firstEpicError.message);
      epicId = firstEpic ? String(firstEpic.id) : undefined;
    }

    if (!epicId) {
      const newEpic: EpicRow = {
        id: randomUUID(),
        workspace_id: team.workspaceId,
        jira_key: null,
        name: 'Manual',
        color: '#4A7FF8'
      };
      const { error: newEpicError } = await this.client.from('epics').insert(newEpic);
      if (newEpicError) throw new Error(newEpicError.message);
      epicId = newEpic.id;
    }

    const newTask: TaskRow = {
      id: randomUUID(),
      workspace_id: team.workspaceId,
      source: 'manual',
      jira_issue_id: null,
      jira_key: null,
      title,
      url: null,
      epic_id: epicId,
      status: 'todo',
      assignee_id: null
    };

    const { error: taskError } = await this.client.from('tasks').insert(newTask);
    if (taskError) throw new Error(taskError.message);

    return this.snapshot(params.teamId, params.userId);
  }

  async updateTeamSettings(params: {
    teamId: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { role } = await this.teamContext(params.teamId, params.userId);
    assertCanManagePeople(role);

    const name = params.name.trim();
    if (!name) throw new Error('Wpisz nazwę teamu.');

    const { error } = await this.client
      .from('teams')
      .update({
        name,
        edit_mode: params.editMode
      })
      .eq('id', params.teamId);
    if (error) throw new Error(error.message);

    return this.snapshot(params.teamId, params.userId);
  }

  async createTeam(params: {
    teamId: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanManagePeople(role);

    const name = params.name.trim();
    if (!name) throw new Error('Wpisz nazwę teamu.');

    const newTeam: TeamRow = {
      id: randomUUID(),
      workspace_id: team.workspaceId,
      name,
      pm_user_id: params.userId,
      edit_mode: params.editMode
    };

    const { error: teamError } = await this.client.from('teams').insert(newTeam);
    if (teamError) throw new Error(teamError.message);

    const { error: memberError } = await this.client.from('team_members').insert({
      team_id: newTeam.id,
      user_id: params.userId,
      role
    });
    if (memberError) throw new Error(memberError.message);

    return this.snapshot(newTeam.id, params.userId);
  }

  async createEmployee(params: {
    teamId: string;
    userId: string;
    name: string;
    tintColor?: string;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanManagePeople(role);

    const name = params.name.trim();
    if (!name) throw new Error('Wpisz imię pracownika.');

    const employee: EmployeeRow = {
      id: randomUUID(),
      workspace_id: team.workspaceId,
      team_id: params.teamId,
      user_id: null,
      name,
      active: true,
      tint_color: params.tintColor || null
    };

    const { error } = await this.client.from('employees').insert(employee);
    if (error) throw new Error(error.message);

    return this.snapshot(params.teamId, params.userId);
  }

  async updateEmployee(params: {
    teamId: string;
    userId: string;
    employeeId: string;
    name?: string;
    tintColor?: string;
    active?: boolean;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { role } = await this.teamContext(params.teamId, params.userId);
    assertCanManagePeople(role);

    const { data: currentEmployee, error: employeeError } = await this.client
      .from('employees')
      .select('id, name, tint_color')
      .eq('id', params.employeeId)
      .eq('team_id', params.teamId)
      .maybeSingle();
    if (employeeError) throw new Error(employeeError.message);
    if (!currentEmployee) throw new Error('Nie znaleziono pracownika.');

    const name = params.name === undefined ? String(currentEmployee.name) : params.name.trim();
    if (!name) throw new Error('Wpisz imię pracownika.');

    const { error } = await this.client
      .from('employees')
      .update({
        name,
        tint_color: params.tintColor ?? currentEmployee.tint_color ?? null,
        active: params.active
      })
      .eq('id', params.employeeId)
      .eq('team_id', params.teamId);
    if (error) throw new Error(error.message);

    return this.snapshot(params.teamId, params.userId);
  }

  async createEpic(params: {
    teamId: string;
    userId: string;
    name: string;
    color: string;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanManagePeople(role);

    const name = params.name.trim();
    if (!name) throw new Error('Wpisz nazwę epica.');

    const epic: EpicRow = {
      id: randomUUID(),
      workspace_id: team.workspaceId,
      jira_key: null,
      name,
      color: params.color || '#4A7FF8'
    };

    const { error } = await this.client.from('epics').insert(epic);
    if (error) throw new Error(error.message);

    return this.snapshot(params.teamId, params.userId);
  }

  async updateEpic(params: {
    teamId: string;
    userId: string;
    epicId: string;
    name?: string;
    color?: string;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanManagePeople(role);

    const { data: currentEpic, error: epicError } = await this.client
      .from('epics')
      .select('id, name, color')
      .eq('id', params.epicId)
      .eq('workspace_id', team.workspaceId)
      .maybeSingle();
    if (epicError) throw new Error(epicError.message);
    if (!currentEpic) throw new Error('Nie znaleziono epica.');

    const name = params.name === undefined ? String(currentEpic.name) : params.name.trim();
    if (!name) throw new Error('Wpisz nazwę epica.');

    const { error } = await this.client
      .from('epics')
      .update({
        name,
        color: params.color ?? currentEpic.color
      })
      .eq('id', params.epicId)
      .eq('workspace_id', team.workspaceId);
    if (error) throw new Error(error.message);

    return this.snapshot(params.teamId, params.userId);
  }

  async deleteEpic(params: {
    teamId: string;
    userId: string;
    epicId: string;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanManagePeople(role);

    const { data: targetEpic, error: targetError } = await this.client
      .from('epics')
      .select('id')
      .eq('id', params.epicId)
      .eq('workspace_id', team.workspaceId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!targetEpic) throw new Error('Nie znaleziono epica.');

    const { data: fallbackEpic, error: fallbackError } = await this.client
      .from('epics')
      .select('id')
      .eq('workspace_id', team.workspaceId)
      .neq('id', params.epicId)
      .limit(1)
      .maybeSingle();
    if (fallbackError) throw new Error(fallbackError.message);

    let fallbackEpicId = fallbackEpic?.id ? String(fallbackEpic.id) : '';
    if (!fallbackEpicId) {
      const newEpic: EpicRow = {
        id: randomUUID(),
        workspace_id: team.workspaceId,
        jira_key: null,
        name: 'Bez epica',
        color: '#9A9890'
      };
      const { error: createError } = await this.client.from('epics').insert(newEpic);
      if (createError) throw new Error(createError.message);
      fallbackEpicId = newEpic.id;
    }

    const { error: taskError } = await this.client
      .from('tasks')
      .update({ epic_id: fallbackEpicId })
      .eq('workspace_id', team.workspaceId)
      .eq('epic_id', params.epicId);
    if (taskError) throw new Error(taskError.message);

    const { error: deleteError } = await this.client
      .from('epics')
      .delete()
      .eq('id', params.epicId)
      .eq('workspace_id', team.workspaceId);
    if (deleteError) throw new Error(deleteError.message);

    return this.snapshot(params.teamId, params.userId);
  }

  async updateTeamMemberRole(params: {
    teamId: string;
    userId: string;
    memberUserId: string;
    role: UserRole;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { role } = await this.teamContext(params.teamId, params.userId);
    assertCanManagePeople(role);

    const { data: currentUser, error: currentUserError } = await this.client
      .from('app_users')
      .select('email')
      .eq('id', params.userId)
      .maybeSingle();
    if (currentUserError) throw new Error(currentUserError.message);
    assertCanGrantRole(currentUser?.email ? String(currentUser.email) : undefined, params.role);

    const { data: member, error: memberError } = await this.client
      .from('team_members')
      .select('team_id, user_id')
      .eq('team_id', params.teamId)
      .eq('user_id', params.memberUserId)
      .maybeSingle();
    if (memberError) throw new Error(memberError.message);
    if (!member) throw new Error('Nie znaleziono członka teamu.');

    const { error } = await this.client
      .from('team_members')
      .update({ role: params.role })
      .eq('team_id', params.teamId)
      .eq('user_id', params.memberUserId);
    if (error) throw new Error(error.message);

    return this.snapshot(params.teamId, params.userId);
  }

  async deleteAssignments(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    await this.assertEmployeeOwnScope(params.teamId, params.userId, role, params.assignmentIds);

    const { error: deleteError } = await this.client
      .from('assignments')
      .delete()
      .eq('team_id', params.teamId)
      .in('id', params.assignmentIds);
    if (deleteError) throw new Error(deleteError.message);

    const remaining = await this.loadAssignmentsForTeam(params.teamId);
    const resolved = resolveSticky(remaining);
    await this.persistResolvedAssignments(remaining, resolved);
    return this.snapshot(params.teamId, params.userId);
  }

  async resizeAssignment(params: {
    teamId: string;
    userId: string;
    assignmentId: string;
    durationHours?: number;
    durationDays?: number;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    await this.assertEmployeeOwnScope(params.teamId, params.userId, role, [params.assignmentId]);

    const allAssignments = await this.loadAssignmentsForTeam(params.teamId);
    const target = allAssignments.find((assignment) => assignment.id === params.assignmentId);
    if (!target) throw new Error('Nie znaleziono assignmentu.');

    const updated = normalizeAssignment({
      ...target,
      durationHours: params.durationHours ?? target.durationHours,
      durationDays: params.durationDays ?? target.durationDays
    });

    const nextAssignments = allAssignments.map((assignment) => (assignment.id === target.id ? updated : assignment));
    const resolved = resolveSticky(nextAssignments, target.id);
    await this.persistResolvedAssignments(allAssignments, resolved);
    return this.snapshot(params.teamId, params.userId);
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
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);
    await this.assertEmployeeOwnScope(params.teamId, params.userId, role, params.assignmentIds, params.targetEmployeeId);

    const allAssignments = await this.loadAssignmentsForTeam(params.teamId);
    const selected = allAssignments.filter((assignment) => params.assignmentIds.includes(assignment.id));
    const anchor = selected.find((assignment) => assignment.id === params.anchorAssignmentId);
    if (!anchor) throw new Error('Nie znaleziono assignmentu kotwiczacego.');

    const dayDelta = diffDays(anchor.startDate, params.targetDate);
    const hourDelta = params.targetStartHour - anchor.startHour;

    const copies = selected.map((assignment) =>
      normalizeAssignment({
        ...assignment,
        id: randomUUID(),
        employeeId: params.targetEmployeeId,
        startDate: shiftIsoDate(assignment.startDate, dayDelta),
        startHour: assignment.startHour + hourDelta,
        desiredStartHour: assignment.startHour + hourDelta,
        version: 1,
        updatedAt: new Date().toISOString()
      })
    );

    const resolved = resolveSticky([...allAssignments, ...copies], copies[0]?.id);
    await this.persistResolvedAssignments(allAssignments, resolved);
    return this.snapshot(params.teamId, params.userId);
  }

  async bulkMoveAssignments(params: {
    teamId: string;
    userId: string;
    moves: Array<{ assignmentId: string; employeeId: string; date: string; startHour: number }>;
  }): Promise<PlannerSnapshot> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    assertCanEditTeam(role, team.editMode);

    await this.assertEmployeeOwnScope(
      params.teamId,
      params.userId,
      role,
      params.moves.map((item) => item.assignmentId)
    );
    for (const move of params.moves) {
      await this.assertEmployeeOwnScope(params.teamId, params.userId, role, undefined, move.employeeId);
    }

    const moveMap = new Map(params.moves.map((move) => [move.assignmentId, move]));
    const allAssignments = await this.loadAssignmentsForTeam(params.teamId);
    const nextAssignments = allAssignments.map((assignment) => {
      const move = moveMap.get(assignment.id);
      if (!move) return assignment;
      return normalizeAssignment({
        ...assignment,
        employeeId: move.employeeId,
        startDate: move.date,
        startHour: move.startHour,
        desiredStartHour: move.startHour
      });
    });

    const resolved = resolveSticky(nextAssignments, params.moves[0]?.assignmentId);
    await this.persistResolvedAssignments(allAssignments, resolved);
    return this.snapshot(params.teamId, params.userId);
  }

  async importFromJira(params: { teamId: string; userId: string; jql: string }): Promise<{ addedTasks: number; addedEpics: number }> {
    await this.ensureUserWorkspaceAndSeed(params.userId);
    const { team, role } = await this.teamContext(params.teamId, params.userId);
    if (role === 'employee') {
      throw new Error('Import z Jiry jest dostepny tylko dla PM/admin.');
    }
    assertCanEditTeam(role, team.editMode);

    const { data: existingEpicsData, error: epicsError } = await this.client
      .from('epics')
      .select('id, workspace_id, jira_key, name, color')
      .eq('workspace_id', team.workspaceId);
    if (epicsError) throw new Error(epicsError.message);
    const existingEpics = (existingEpicsData as EpicRow[]).map(toEpic);

    const { data: existingTasksData, error: tasksError } = await this.client
      .from('tasks')
      .select('id, workspace_id, source, jira_issue_id, jira_key, title, url, epic_id, status, assignee_id')
      .eq('workspace_id', team.workspaceId);
    if (tasksError) throw new Error(tasksError.message);
    const existingTasks = (existingTasksData as TaskRow[]).map(toTask);

    const epicByJiraKey = new Map(existingEpics.filter((epic) => epic.jiraKey).map((epic) => [String(epic.jiraKey), epic]));
    const taskKeySet = new Set(existingTasks.map((task) => `${task.jiraIssueId ?? ''}|${task.jiraKey ?? ''}`));

    const issues = await fetchJiraIssues(params.jql);
    let addedEpics = 0;
    let addedTasks = 0;

    for (const issue of issues) {
      let epicId = existingEpics[0]?.id;
      if (issue.epic?.key) {
        const existingEpic = epicByJiraKey.get(issue.epic.key);
        if (existingEpic) {
          epicId = existingEpic.id;
        } else {
          const newEpic: EpicRow = {
            id: randomUUID(),
            workspace_id: team.workspaceId,
            jira_key: issue.epic.key,
            name: issue.epic.name,
            color: issue.epic.color
          };
          const { error: newEpicError } = await this.client.from('epics').insert(newEpic);
          if (newEpicError) throw new Error(newEpicError.message);
          epicByJiraKey.set(issue.epic.key, toEpic(newEpic));
          epicId = newEpic.id;
          addedEpics += 1;
        }
      }

      const taskFingerprint = `${issue.issueId}|${issue.key}`;
      if (taskKeySet.has(taskFingerprint)) continue;

      const newTask: TaskRow = {
        id: randomUUID(),
        workspace_id: team.workspaceId,
        source: 'jira',
        jira_issue_id: issue.issueId,
        jira_key: issue.key,
        title: issue.title,
        url: issue.url,
        epic_id: epicId ?? existingEpics[0]?.id ?? '',
        status: issue.status ?? null,
        assignee_id: null
      };
      if (!newTask.epic_id) continue;
      const { error: insertTaskError } = await this.client.from('tasks').insert(newTask);
      if (insertTaskError) throw new Error(insertTaskError.message);
      taskKeySet.add(taskFingerprint);
      addedTasks += 1;
    }

    return { addedTasks, addedEpics };
  }
}
