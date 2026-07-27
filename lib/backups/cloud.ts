import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlannerBackup } from '@/lib/domain/types';

export const BACKUP_BUCKET = process.env.SUPABASE_BACKUP_BUCKET || 'planner-backups';

export type CloudBackupFile = {
  path: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
  size?: number;
};

type WorkspaceRow = {
  id: string;
  name: string;
  google_auth_enabled: boolean;
  jira_connected: boolean;
  slack_connected: boolean;
};

type TeamRow = {
  id: string;
  workspace_id: string;
  name: string;
  pm_user_id: string;
  edit_mode: 'collaborative' | 'pm_only';
};

type AppUserRow = {
  id: string;
  workspace_id: string;
  email: string;
  name: string;
  google_sub?: string | null;
  slack_user_id?: string | null;
};

type TeamMemberRow = {
  team_id: string;
  user_id: string;
  role: 'admin' | 'pm' | 'employee';
};

type WorkspaceInviteRow = {
  id: string;
  workspace_id: string;
  team_id: string;
  email: string;
  name: string;
  role: 'admin' | 'pm' | 'employee';
  employee_name: string | null;
  tint_color: string | null;
  active: boolean;
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
  team_id?: string | null;
  jira_key: string | null;
  name: string;
  color: string;
};

type TaskRow = {
  id: string;
  workspace_id: string;
  team_id?: string | null;
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

function warsawParts(date = new Date()): { date: string; hour: string; minute: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    hour: value('hour'),
    minute: value('minute')
  };
}

export function shouldRunScheduledBackup(date = new Date()): boolean {
  const { hour } = warsawParts(date);
  return hour === '12' || hour === '17';
}

export function backupPath(workspaceId: string, date = new Date()): string {
  const parts = warsawParts(date);
  return `${workspaceId}/${parts.date}/${parts.hour}-00.json`;
}

export async function ensureBackupBucket(client: SupabaseClient): Promise<void> {
  const { data, error } = await client.storage.getBucket(BACKUP_BUCKET);
  if (!error && data) return;

  const { error: createError } = await client.storage.createBucket(BACKUP_BUCKET, {
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['application/json']
  });
  if (createError && !createError.message.toLowerCase().includes('already exists')) {
    throw new Error(createError.message);
  }
}

export async function uploadPlannerBackup(
  client: SupabaseClient,
  backup: PlannerBackup,
  path = backupPath(backup.workspace.id)
): Promise<string> {
  await ensureBackupBucket(client);
  const payload = JSON.stringify(backup, null, 2);
  const { error } = await client.storage.from(BACKUP_BUCKET).upload(path, payload, {
    contentType: 'application/json; charset=utf-8',
    upsert: true
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function listPlannerBackups(client: SupabaseClient, workspaceId: string): Promise<CloudBackupFile[]> {
  await ensureBackupBucket(client);
  const { data: dayFolders, error } = await client.storage.from(BACKUP_BUCKET).list(workspaceId, {
    limit: 60,
    sortBy: { column: 'name', order: 'desc' }
  });
  if (error) throw new Error(error.message);

  const files: CloudBackupFile[] = [];
  for (const folder of dataFolders(dayFolders)) {
    const folderPath = `${workspaceId}/${folder.name}`;
    const { data: folderFiles, error: folderError } = await client.storage.from(BACKUP_BUCKET).list(folderPath, {
      limit: 24,
      sortBy: { column: 'name', order: 'desc' }
    });
    if (folderError) throw new Error(folderError.message);
    for (const file of folderFiles ?? []) {
      if (!file.name.endsWith('.json')) continue;
      files.push({
        path: `${folderPath}/${file.name}`,
        name: `${folder.name} ${file.name.replace('.json', '')}`,
        createdAt: file.created_at,
        updatedAt: file.updated_at,
        size: file.metadata?.size
      });
    }
  }
  return files.sort((a, b) => b.path.localeCompare(a.path)).slice(0, 60);
}

function dataFolders(items: Array<{ name: string }> | null) {
  return (items ?? []).filter((item) => !item.name.endsWith('.json'));
}

export async function downloadPlannerBackup(client: SupabaseClient, path: string): Promise<PlannerBackup> {
  await ensureBackupBucket(client);
  const { data, error } = await client.storage.from(BACKUP_BUCKET).download(path);
  if (error) throw new Error(error.message);
  return JSON.parse(await data.text()) as PlannerBackup;
}

export async function exportWorkspaceBackup(client: SupabaseClient, workspaceId: string): Promise<PlannerBackup | null> {
  const [workspaceResult, teamsResult, usersResult, invitesResult, employeesResult, epicsResult, tasksResult, assignmentsResult] = await Promise.all([
    client.from('workspaces').select('id, name, google_auth_enabled, jira_connected, slack_connected').eq('id', workspaceId).single(),
    client.from('teams').select('id, workspace_id, name, pm_user_id, edit_mode').eq('workspace_id', workspaceId),
    client.from('app_users').select('id, workspace_id, email, name, google_sub, slack_user_id').eq('workspace_id', workspaceId),
    client.from('workspace_invites').select('id, workspace_id, team_id, email, name, role, employee_name, tint_color, active').eq('workspace_id', workspaceId),
    client.from('employees').select('id, workspace_id, team_id, user_id, name, active, tint_color').eq('workspace_id', workspaceId),
    client.from('epics').select('id, workspace_id, team_id, jira_key, name, color').eq('workspace_id', workspaceId),
    client.from('tasks').select('id, workspace_id, team_id, source, jira_issue_id, jira_key, title, url, epic_id, status, assignee_id').eq('workspace_id', workspaceId),
    client.from('assignments').select('id, workspace_id, team_id, task_id, employee_id, start_date, start_hour, desired_start_hour, duration_hours, duration_days, completion_ratio, version, updated_at').eq('workspace_id', workspaceId)
  ]);

  if (workspaceResult.error) throw new Error(workspaceResult.error.message);
  if (teamsResult.error) throw new Error(teamsResult.error.message);
  if (usersResult.error) throw new Error(usersResult.error.message);
  if (invitesResult.error) throw new Error(invitesResult.error.message);
  if (employeesResult.error) throw new Error(employeesResult.error.message);
  if (epicsResult.error) throw new Error(epicsResult.error.message);
  if (tasksResult.error) throw new Error(tasksResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);

  const teams = (teamsResult.data as TeamRow[]) ?? [];
  if (!teams.length) return null;
  const teamIds = new Set(teams.map((team) => team.id));

  const { data: memberData, error: memberError } = await client
    .from('team_members')
    .select('team_id, user_id, role')
    .in('team_id', Array.from(teamIds));
  if (memberError) throw new Error(memberError.message);

  const workspace = workspaceResult.data as WorkspaceRow;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      googleAuthEnabled: workspace.google_auth_enabled,
      jiraConnected: workspace.jira_connected,
      slackConnected: workspace.slack_connected
    },
    teams: teams.map((team) => ({
      id: team.id,
      workspaceId: team.workspace_id,
      name: team.name,
      pmUserId: team.pm_user_id,
      editMode: team.edit_mode
    })),
    members: ((memberData as TeamMemberRow[]) ?? []).map((member) => ({
      teamId: member.team_id,
      userId: member.user_id,
      role: member.role
    })),
    invites: ((invitesResult.data as WorkspaceInviteRow[]) ?? [])
      .filter((invite) => teamIds.has(invite.team_id))
      .map((invite) => ({
        id: invite.id,
        workspaceId: invite.workspace_id,
        teamId: invite.team_id,
        email: invite.email,
        name: invite.name,
        role: invite.role,
        employeeName: invite.employee_name ?? undefined,
        tintColor: invite.tint_color ?? undefined,
        active: invite.active
      })),
    users: ((usersResult.data as AppUserRow[]) ?? []).map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      googleSub: user.google_sub ?? undefined,
      slackUserId: user.slack_user_id ?? undefined
    })),
    employees: ((employeesResult.data as EmployeeRow[]) ?? []).map((employee) => ({
      id: employee.id,
      workspaceId: employee.workspace_id,
      teamId: employee.team_id,
      userId: employee.user_id ?? undefined,
      name: employee.name,
      active: employee.active,
      tintColor: employee.tint_color ?? undefined
    })),
    epics: ((epicsResult.data as EpicRow[]) ?? []).map((epic) => ({
      id: epic.id,
      workspaceId: epic.workspace_id,
      teamId: epic.team_id ?? undefined,
      jiraKey: epic.jira_key ?? undefined,
      name: epic.name,
      color: epic.color
    })),
    tasks: ((tasksResult.data as TaskRow[]) ?? []).map((task) => ({
      id: task.id,
      workspaceId: task.workspace_id,
      teamId: task.team_id ?? undefined,
      source: task.source,
      jiraIssueId: task.jira_issue_id ?? undefined,
      jiraKey: task.jira_key ?? undefined,
      title: task.title,
      url: task.url ?? undefined,
      epicId: task.epic_id,
      status: task.status ?? undefined,
      assigneeId: task.assignee_id ?? undefined
    })),
    assignments: ((assignmentsResult.data as AssignmentRow[]) ?? []).map((assignment) => ({
      id: assignment.id,
      workspaceId: assignment.workspace_id,
      teamId: assignment.team_id,
      taskId: assignment.task_id,
      employeeId: assignment.employee_id,
      startDate: assignment.start_date,
      startHour: assignment.start_hour,
      desiredStartHour: assignment.desired_start_hour,
      durationHours: assignment.duration_hours,
      durationDays: assignment.duration_days,
      completionRatio: assignment.completion_ratio ?? undefined,
      version: assignment.version,
      updatedAt: assignment.updated_at
    }))
  };
}
