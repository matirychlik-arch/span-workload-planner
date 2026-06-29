import { z } from 'zod';
import { getStore } from '@/lib/data/store';
import { fail, ok, parseBody } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

const bodySchema = z.object({
  teamId: z.string().min(1),
  employeeId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  tintColor: z.string().trim().min(1).max(40).optional(),
  active: z.boolean().optional()
});

export async function PATCH(request: Request) {
  try {
    const payload = await parseBody(request, bodySchema);
    const userId = await resolveCurrentUserId();
    const snapshot = await getStore().updateEmployee({ ...payload, userId });
    return ok(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się zapisać pracownika.';
    return fail(message, 400);
  }
}
