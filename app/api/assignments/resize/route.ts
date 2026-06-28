import { z } from 'zod';
import { getStore } from '@/lib/data/store';
import { fail, ok, parseBody } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

const bodySchema = z.object({
  teamId: z.string().min(1),
  assignmentId: z.string().min(1),
  durationHours: z.number().int().min(1).max(12).optional(),
  durationDays: z.number().int().min(1).max(10).optional()
});

export async function POST(request: Request) {
  try {
    const payload = await parseBody(request, bodySchema);
    const userId = await resolveCurrentUserId();
    const snapshot = await getStore().resizeAssignment({ ...payload, userId });
    return ok(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się zmienić czasu zadania.';
    return fail(message, 400);
  }
}
