export type UserRole = 'admin' | 'pm' | 'employee';
export type TeamEditMode = 'collaborative' | 'pm_only';
export type TaskSource = 'jira' | 'manual';
export type TaskKind = 'task' | 'meeting';
export type RepeatFrequency = 'daily' | 'weekdays';

export interface RecurrenceRule {
  id: string;
  workspaceId: string;
  teamId: string;
  taskId: string;
  employeeId: string;
  startDate: string;
  startHour: number;
  durationHours: number;
  frequency: RepeatFrequency;
  until: string | null;
  generatedDates: string[];
}

export interface Workspace {
  id: string;
  name: string;
  googleAuthEnabled: boolean;
  jiraConnected: boolean;
  slackConnected: boolean;
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  googleSub?: string;
  slackUserId?: string;
}

export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  pmUserId: string;
  editMode: TeamEditMode;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  role: UserRole;
}

export interface WorkspaceInvite {
  id: string;
  workspaceId: string;
  teamId: string;
  email: string;
  name: string;
  role: UserRole;
  employeeName?: string;
  tintColor?: string;
  active: boolean;
}

export interface Employee {
  id: string;
  workspaceId: string;
  teamId: string;
  userId?: string;
  name: string;
  active: boolean;
  tintColor?: string;
}

export interface Epic {
  id: string;
  workspaceId: string;
  teamId?: string;
  jiraKey?: string;
  name: string;
  color: string;
}

export interface Task {
  kind?: TaskKind;
  id: string;
  workspaceId: string;
  teamId?: string;
  source: TaskSource;
  jiraIssueId?: string;
  jiraKey?: string;
  title: string;
  url?: string;
  epicId: string;
  status?: string;
  assigneeId?: string;
}

export interface Assignment {
  recurrenceId?: string;
  id: string;
  workspaceId: string;
  teamId: string;
  taskId: string;
  employeeId: string;
  startDate: string;
  startHour: number;
  desiredStartHour: number;
  durationHours: number;
  durationDays: number;
  completionRatio?: number;
  version: number;
  updatedAt: string;
}

export interface PlannerWindow {
  from: string;
  to: string;
}

export interface PlannerSnapshot {
  recurrences?: RecurrenceRule[];
  workspace: Workspace;
  team: Team;
  members: TeamMember[];
  users: AppUser[];
  employees: Employee[];
  tasks: Task[];
  epics: Epic[];
  assignments: Assignment[];
  currentUserId: string;
  currentRole: UserRole;
  canEdit: boolean;
}

export interface DataStore {
  repeatAssignment(params: { teamId: string; userId: string; assignmentId: string; frequency: RepeatFrequency; until: string | null }): Promise<PlannerSnapshot>;
  stopRecurrence(params: { teamId: string; userId: string; assignmentId: string }): Promise<PlannerSnapshot>;
  listTeamsForUser(userId: string): Promise<Array<Team & { role: UserRole }>>;
  getPlannerSnapshot(params: {
    teamId: string;
    userId: string;
    from: string;
    to: string;
  }): Promise<PlannerSnapshot>;
  moveAssignments(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
    anchorAssignmentId: string;
    targetEmployeeId: string;
    targetDate: string;
    targetStartHour: number;
  }): Promise<PlannerSnapshot>;
  createAssignment(params: {
    teamId: string;
    userId: string;
    taskId: string;
    employeeId: string;
    startDate: string;
    startHour: number;
    durationHours?: number;
    durationDays?: number;
  }): Promise<PlannerSnapshot>;
  createManualTask(params: {
    kind?: TaskKind;
    teamId: string;
    userId: string;
    title: string;
    description?: string;
    epicId?: string;
  }): Promise<PlannerSnapshot>;
  deleteTasks(params: {
    teamId: string;
    userId: string;
    taskIds: string[];
  }): Promise<PlannerSnapshot>;
  updateTeamSettings(params: {
    teamId: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
  }): Promise<PlannerSnapshot>;
  createTeam(params: {
    teamId?: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
    workspaceName?: string;
  }): Promise<PlannerSnapshot>;
  updateWorkspaceSettings(params: {
    teamId: string;
    userId: string;
    name: string;
  }): Promise<PlannerSnapshot>;
  deleteTeam(params: {
    teamId: string;
    userId: string;
  }): Promise<{ nextTeamId: string | null }>;
  createEmployee(params: {
    teamId: string;
    userId: string;
    name: string;
    tintColor?: string;
  }): Promise<PlannerSnapshot>;
  updateEmployee(params: {
    teamId: string;
    userId: string;
    employeeId: string;
    name?: string;
    tintColor?: string;
    active?: boolean;
  }): Promise<PlannerSnapshot>;
  createEpic(params: {
    teamId: string;
    userId: string;
    name: string;
    color: string;
  }): Promise<PlannerSnapshot>;
  updateEpic(params: {
    teamId: string;
    userId: string;
    epicId: string;
    name?: string;
    color?: string;
  }): Promise<PlannerSnapshot>;
  deleteEpic(params: {
    teamId: string;
    userId: string;
    epicId: string;
  }): Promise<PlannerSnapshot>;
  updateTeamMemberRole(params: {
    teamId: string;
    userId: string;
    memberUserId: string;
    role: UserRole;
  }): Promise<PlannerSnapshot>;
  deleteAssignments(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
  }): Promise<PlannerSnapshot>;
  updateAssignmentsEpic(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
    epicId: string;
  }): Promise<PlannerSnapshot>;
  updateTask(params: {
    kind?: TaskKind;
    teamId: string;
    userId: string;
    assignmentId: string;
    title: string;
    description?: string;
    epicId: string;
  }): Promise<PlannerSnapshot>;
  resizeAssignment(params: {
    teamId: string;
    userId: string;
    assignmentId: string;
    durationHours?: number;
    durationDays?: number;
  }): Promise<PlannerSnapshot>;
  copyAssignments(params: {
    teamId: string;
    userId: string;
    assignmentIds: string[];
    anchorAssignmentId: string;
    targetEmployeeId: string;
    targetDate: string;
    targetStartHour: number;
    linkTasks?: boolean;
  }): Promise<PlannerSnapshot>;
  bulkMoveAssignments(params: {
    teamId: string;
    userId: string;
    moves: Array<{ assignmentId: string; employeeId: string; date: string; startHour: number }>;
  }): Promise<PlannerSnapshot>;
  importFromJira(params: { teamId: string; userId: string; jql: string }): Promise<{
    addedTasks: number;
    addedEpics: number;
  }>;
  importFromExcel(params: { teamId: string; userId: string; fileName: string; data: ArrayBuffer }): Promise<ExcelImportResult>;
  exportPlannerBackup(params: {
    teamId: string;
    userId: string;
  }): Promise<PlannerBackup>;
  restorePlannerBackup(params: {
    teamId: string;
    userId: string;
    backup: PlannerBackup;
  }): Promise<PlannerSnapshot>;
}


export interface ExcelImportResult {
  addedTasks: number;
  addedAssignments: number;
  updatedAssignments: number;
  skippedRows: number;
  skippedEmployees: string[];
  firstDate?: string;
  lastDate?: string;
}

export interface PlannerBackup {
  recurrences?: RecurrenceRule[];
  version: 1;
  exportedAt: string;
  workspace: Workspace;
  teams: Team[];
  members: TeamMember[];
  invites?: WorkspaceInvite[];
  users: AppUser[];
  employees: Employee[];
  epics: Epic[];
  tasks: Task[];
  assignments: Assignment[];
}
