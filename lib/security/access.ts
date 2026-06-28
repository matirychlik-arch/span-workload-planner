import { TeamEditMode, TeamMember, UserRole } from '@/lib/domain/types';

export function roleForUser(members: TeamMember[], userId: string): UserRole | null {
  const member = members.find((item) => item.userId === userId);
  return member?.role ?? null;
}

export function assertTeamAccess(members: TeamMember[], userId: string): UserRole {
  const role = roleForUser(members, userId);
  if (!role) {
    throw new Error('Brak dostępu do zespołu.');
  }
  return role;
}

export function canEditTeam(role: UserRole, editMode: TeamEditMode): boolean {
  if (role === 'admin' || role === 'pm') return true;
  if (role === 'employee') return editMode === 'collaborative';
  return false;
}

export function assertCanEditTeam(role: UserRole, editMode: TeamEditMode): void {
  if (!canEditTeam(role, editMode)) {
    throw new Error('Brak uprawnień do edycji planu w tym zespole.');
  }
}
