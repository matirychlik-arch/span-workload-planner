import { getStore } from '@/lib/data/store';
import { ok, fail } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';
import { weekRangeFor } from '@/lib/domain/time';

function parseParam(searchParams: URLSearchParams, key: string, fallback: string): string {
  const value = searchParams.get(key);
  return value && value.trim().length > 0 ? value : fallback;
}

export async function GET(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const url = new URL(request.url);
    const teamId = url.searchParams.get('teamId');
    if (!teamId) return fail('Brakuje teamId.', 400);

    const currentWeek = weekRangeFor(new Date());
    const from = parseParam(url.searchParams, 'from', currentWeek.from);
    const to = parseParam(url.searchParams, 'to', currentWeek.to);

    const snapshot = await getStore().getPlannerSnapshot({ teamId, userId, from, to });
    return ok(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się pobrać plannera.';
    return fail(message, 400);
  }
}
