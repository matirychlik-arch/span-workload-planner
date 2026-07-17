import { getStore } from '@/lib/data/store';
import { fail, ok } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';
import type { PlannerBackup } from '@/lib/domain/types';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const teamId = String(form.get('teamId') ?? '');
    const file = form.get('file');
    if (!teamId) return fail('Brakuje teamId.', 400);
    if (!file || typeof file !== 'object' || !('text' in file)) {
      return fail('Dodaj plik backupu .json.', 400);
    }

    const backup = JSON.parse(await (file as File).text()) as PlannerBackup;
    const userId = await resolveCurrentUserId();
    const snapshot = await getStore().restorePlannerBackup({ teamId, userId, backup });
    return ok(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się przywrócić backupu.';
    return fail(message, 400);
  }
}
