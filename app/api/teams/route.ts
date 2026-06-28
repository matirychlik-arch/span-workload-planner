import { getStore } from '@/lib/data/store';
import { ok, fail } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

export async function GET() {
  try {
    const userId = await resolveCurrentUserId();
    const teams = await getStore().listTeamsForUser(userId);
    return ok(teams);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się pobrać zespołów.';
    return fail(message, 500);
  }
}
