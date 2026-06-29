import type { UserRole } from '@/lib/domain/types';

export const OWNER_EMAIL = 'matirychlik@gmail.com';
export const MATEUSZ_WORK_EMAIL = 'mateusz.rychlik@mobilevikings.pl';
export const CREATIVE_TEAM_NAME = 'Kreatywny';

export const CREATIVE_EMPLOYEES = [
  { name: 'Mateusz - grafik', tintColor: '#EEF3FF', key: 'mateusz' },
  { name: 'Marcin - grafik', tintColor: '#F6EFE8', key: 'marcin' },
  { name: 'Patrycja - copywriterka', tintColor: '#EEF7EF', key: 'patrycja' },
  { name: 'Adam - copywriter / traffic', tintColor: '#F2EDFA', key: 'adam' },
  { name: 'Karo - PM', tintColor: '#FCF5E8', key: 'karo' }
] as const;

export function normalizeEmail(email?: string | null): string {
  return (email ?? '').trim().toLowerCase();
}

export function isOwnerEmail(email?: string | null): boolean {
  return normalizeEmail(email) === OWNER_EMAIL;
}

export function canManagePeople(role: UserRole): boolean {
  return role === 'admin';
}

export function assertCanManagePeople(role: UserRole): void {
  if (!canManagePeople(role)) {
    throw new Error('Pracownikami i teamami może zarządzać tylko admin.');
  }
}

export function assertCanGrantRole(currentUserEmail: string | undefined, nextRole: UserRole): void {
  if (nextRole === 'admin' && !isOwnerEmail(currentUserEmail)) {
    throw new Error('Adminów może nadawać tylko matirychlik@gmail.com.');
  }
}
