export type UserRole = 'admin' | 'pm' | 'employee';
export type TeamEditMode = 'collaborative' | 'pm_only';
export type TaskSource = 'jira' | 'manual';

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
  jiraKey?: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  workspaceId: string;
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
    teamId: string;
    userId: string;
    title: string;
    epicId?: string;
  }): Promise<PlannerSnapshot>;
  updateTeamSettings(params: {
    teamId: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
  }): Promise<PlannerSnapshot>;
  createTeam(params: {
    teamId: string;
    userId: string;
    name: string;
    editMode: TeamEditMode;
  }): Promise<PlannerSnapshot>;
  deleteTeam(params: {
    teamId: string;
    userId: string;
  }): Promise<{ nextTeamId: string }>;
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
}
