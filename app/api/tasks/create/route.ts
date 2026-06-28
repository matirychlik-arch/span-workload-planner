import { z } from 'zod';
import { getStore } from '@/lib/data/store';
import { fail, ok, parseBody } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

const bodySchema = z.object({
  teamId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  epicId: z.string().min(1).optional()
});

export async function POST(request: Request) {
  try {
    const payload = await parseBody(request, bodySchema);
    const userId = await resolveCurrentUserId();
    const snapshot = await getStore().createManualTask({ ...payload, userId });
    return ok(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się utworzyć taska.';
    return fail(message, 400);
  }
}
