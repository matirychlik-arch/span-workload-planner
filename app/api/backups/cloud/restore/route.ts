import { z } from 'zod';
import { getStore } from '@/lib/data/store';
import { downloadPlannerBackup } from '@/lib/backups/cloud';
import { fail, ok, parseBody } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const schema = z.object({
  teamId: z.string().min(1),
  path: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const body = await parseBody(request, schema);
    const currentBackup = await getStore().exportPlannerBackup({ teamId: body.teamId, userId });
    if (!body.path.startsWith(`${currentBackup.workspace.id}/`)) {
      return fail('Ten backup nie należy do aktualnej firmy.', 403);
    }

    const backup = await downloadPlannerBackup(createSupabaseAdminClient(), body.path);
    const snapshot = await getStore().restorePlannerBackup({ teamId: body.teamId, userId, backup });
    return ok(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się przywrócić backupu.';
    return fail(message, 400);
  }
}
