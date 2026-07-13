import { AppUser, Assignment, Employee, Epic, Task, Team, TeamMember, Workspace } from '@/lib/domain/types';
import { OWNER_EMAIL } from '@/lib/security/roles';

export const seedWorkspace: Workspace = {
  id: 'ws-span',
  name: 'SPAN',
  googleAuthEnabled: true,
  jiraConnected: false,
  slackConnected: false
};

export const seedUsers: AppUser[] = [
  { id: 'u-admin', email: OWNER_EMAIL, name: 'Mateusz admin' }
];

export const seedTeams: Team[] = [];

export const seedTeamMembers: TeamMember[] = [];

export const seedEmployees: Employee[] = [];

export const seedEpics: Epic[] = [
  { id: 'ep-manual', workspaceId: seedWorkspace.id, name: 'Manual', color: '#4A7FF8' }
];

export const seedTasks: Task[] = [];

export const seedAssignments: Assignment[] = [];
