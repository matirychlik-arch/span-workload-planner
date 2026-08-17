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
  { id: 'ep-color-blue', workspaceId: seedWorkspace.id, name: 'Kolor 1', color: '#4A7FF8' },
  { id: 'ep-color-green', workspaceId: seedWorkspace.id, name: 'Kolor 2', color: '#45A676' },
  { id: 'ep-color-amber', workspaceId: seedWorkspace.id, name: 'Kolor 3', color: '#D69A2D' },
  { id: 'ep-color-coral', workspaceId: seedWorkspace.id, name: 'Kolor 4', color: '#E66A4E' },
  { id: 'ep-color-violet', workspaceId: seedWorkspace.id, name: 'Kolor 5', color: '#8A63D2' },
  { id: 'ep-color-mint', workspaceId: seedWorkspace.id, name: 'Kolor 6', color: '#4CA6A8' },
  { id: 'ep-color-pink', workspaceId: seedWorkspace.id, name: 'Kolor 7', color: '#D85A9A' },
  { id: 'ep-color-slate', workspaceId: seedWorkspace.id, name: 'Kolor 8', color: '#64748B' }
];

export const seedTasks: Task[] = [];

export const seedAssignments: Assignment[] = [];
