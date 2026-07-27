import { getStore } from '@/lib/data/store';
import { fail, ok } from '@/lib/api/http';
import { listPlannerBackups } from '@/lib/backups/cloud';
import { resolveCurrentUserId } from '@/lib/auth/session';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const url = new URL(request.url);
    const teamId = url.searchParams.get('teamId');
    if (!teamId) return fail('Brakuje teamId.', 400);

    const backup = await getStore().exportPlannerBackup({ teamId, userId });
    const files = await listPlannerBackups(createSupabaseAdminClient(), backup.workspace.id);
    return ok(files);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się pobrać listy backupów.';
    return fail(message, 400);
  }
}
