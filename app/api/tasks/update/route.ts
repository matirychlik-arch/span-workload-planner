import { z } from 'zod';
import { getStore } from '@/lib/data/store';
import { fail, ok, parseBody } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

const bodySchema = z.object({
  teamId: z.string().min(1),
  assignmentId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(240).optional(),
  epicId: z.string().min(1)
});

export async function PATCH(request: Request) {
  try {
    const payload = await parseBody(request, bodySchema);
    const userId = await resolveCurrentUserId();
    const snapshot = await getStore().updateTask({ ...payload, userId });
    return ok(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się zapisać taska.';
    return fail(message, 400);
  }
}
