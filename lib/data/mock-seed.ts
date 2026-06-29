import { AppUser, Assignment, Employee, Epic, Task, Team, TeamMember, Workspace } from '@/lib/domain/types';
import { CREATIVE_TEAM_NAME, OWNER_EMAIL, MATEUSZ_WORK_EMAIL } from '@/lib/security/roles';

const now = new Date().toISOString();

export const seedWorkspace: Workspace = {
  id: 'ws-span',
  name: 'SPAN Workspace',
  googleAuthEnabled: true,
  jiraConnected: false,
  slackConnected: false
};

export const seedUsers: AppUser[] = [
  { id: 'u-admin', email: OWNER_EMAIL, name: 'Mateusz admin' },
  { id: 'u-marcin', email: 'marcin@span.local', name: 'Marcin' },
  { id: 'u-mateusz', email: MATEUSZ_WORK_EMAIL, name: 'Mateusz' },
  { id: 'u-adam', email: 'adam@span.local', name: 'Adam' },
  { id: 'u-karo', email: 'karo@span.local', name: 'Karo' }
];

export const seedTeams: Team[] = [
  {
    id: 'team-design',
    workspaceId: seedWorkspace.id,
    name: CREATIVE_TEAM_NAME,
    pmUserId: 'u-admin',
    editMode: 'collaborative'
  }
];

export const seedTeamMembers: TeamMember[] = [
  { teamId: 'team-design', userId: 'u-admin', role: 'admin' },
  { teamId: 'team-design', userId: 'u-marcin', role: 'employee' },
  { teamId: 'team-design', userId: 'u-mateusz', role: 'employee' },
  { teamId: 'team-design', userId: 'u-adam', role: 'admin' },
  { teamId: 'team-design', userId: 'u-karo', role: 'admin' }
];

export const seedEmployees: Employee[] = [
  {
    id: 'emp-marcin',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    userId: 'u-marcin',
    name: 'Marcin - grafik',
    active: true,
    tintColor: '#F6EFE8'
  },
  {
    id: 'emp-mateusz',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    userId: 'u-mateusz',
    name: 'Mateusz - grafik',
    active: true,
    tintColor: '#EEF3FF'
  },
  {
    id: 'emp-patrycja',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    name: 'Patrycja - copywriterka',
    active: true,
    tintColor: '#EEF7EF'
  },
  {
    id: 'emp-adam',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    userId: 'u-adam',
    name: 'Adam - copywriter / traffic',
    active: true,
    tintColor: '#F2EDFA'
  },
  {
    id: 'emp-karo',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    userId: 'u-karo',
    name: 'Karo - PM',
    active: true,
    tintColor: '#FCF5E8'
  }
];

export const seedEpics: Epic[] = [
  { id: 'ep-kreatywka', workspaceId: seedWorkspace.id, jiraKey: 'EP-1', name: 'kreatywka', color: '#4A7FF8' },
  { id: 'ep-eventy', workspaceId: seedWorkspace.id, jiraKey: 'EP-2', name: 'eventy', color: '#FFC757' },
  { id: 'ep-branding', workspaceId: seedWorkspace.id, jiraKey: 'EP-3', name: 'branding', color: '#FF7648' },
  { id: 'ep-seo', workspaceId: seedWorkspace.id, jiraKey: 'EP-4', name: 'seo', color: '#D9B7FF' },
  { id: 'ep-blindsim', workspaceId: seedWorkspace.id, jiraKey: 'EP-5', name: 'blindsim', color: '#BBD7B8' }
];

export const seedTasks: Task[] = [
  {
    id: 'task-mv-101',
    workspaceId: seedWorkspace.id,
    source: 'manual',
    jiraKey: 'MV-101',
    title: 'Kreatywka',
    epicId: 'ep-kreatywka'
  },
  {
    id: 'task-mv-102',
    workspaceId: seedWorkspace.id,
    source: 'jira',
    jiraIssueId: 'jira-102',
    jiraKey: 'MV-102',
    title: 'Eventy - projekty graficzne',
    url: 'https://jira.example.local/browse/MV-102',
    epicId: 'ep-eventy',
    status: 'To Do'
  },
  {
    id: 'task-mv-103',
    workspaceId: seedWorkspace.id,
    source: 'jira',
    jiraIssueId: 'jira-103',
    jiraKey: 'MV-103',
    title: 'Branding: 1 partia',
    url: 'https://jira.example.local/browse/MV-103',
    epicId: 'ep-branding',
    status: 'In Progress'
  },
  {
    id: 'task-mv-104',
    workspaceId: seedWorkspace.id,
    source: 'manual',
    jiraKey: 'MV-104',
    title: '[seo] przygotować szablon strony',
    epicId: 'ep-seo'
  },
  {
    id: 'task-mv-107',
    workspaceId: seedWorkspace.id,
    source: 'jira',
    jiraIssueId: 'jira-107',
    jiraKey: 'MV-107',
    title: 'BlindSIM - poprawki opakowania',
    url: 'https://jira.example.local/browse/MV-107',
    epicId: 'ep-blindsim',
    status: 'To Do'
  }
];

export const seedAssignments: Assignment[] = [
  {
    id: 'asn-1',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    taskId: 'task-mv-101',
    employeeId: 'emp-marcin',
    startDate: '2026-06-01',
    startHour: 7,
    desiredStartHour: 7,
    durationHours: 1,
    durationDays: 1,
    version: 1,
    updatedAt: now
  },
  {
    id: 'asn-2',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    taskId: 'task-mv-102',
    employeeId: 'emp-marcin',
    startDate: '2026-06-01',
    startHour: 10,
    desiredStartHour: 10,
    durationHours: 2,
    durationDays: 1,
    version: 1,
    updatedAt: now
  },
  {
    id: 'asn-3',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    taskId: 'task-mv-104',
    employeeId: 'emp-marcin',
    startDate: '2026-06-02',
    startHour: 12,
    desiredStartHour: 12,
    durationHours: 2,
    durationDays: 1,
    version: 1,
    updatedAt: now
  },
  {
    id: 'asn-4',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    taskId: 'task-mv-107',
    employeeId: 'emp-marcin',
    startDate: '2026-06-01',
    startHour: 14,
    desiredStartHour: 14,
    durationHours: 2,
    durationDays: 3,
    version: 1,
    updatedAt: now
  },
  {
    id: 'asn-5',
    workspaceId: seedWorkspace.id,
    teamId: 'team-design',
    taskId: 'task-mv-103',
    employeeId: 'emp-mateusz',
    startDate: '2026-06-02',
    startHour: 10,
    desiredStartHour: 10,
    durationHours: 2,
    durationDays: 1,
    version: 1,
    updatedAt: now
  }
];
