import { z } from 'zod';
import { getStore } from '@/lib/data/store';
import { fail, ok, parseBody } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

const bodySchema = z.object({
  teamId: z.string().min(1),
  assignmentIds: z.array(z.string().min(1)).min(1),
  anchorAssignmentId: z.string().min(1),
  targetEmployeeId: z.string().min(1),
  targetDate: z.string().min(10),
  targetStartHour: z.number().int().min(0).max(23)
});

export async function POST(request: Request) {
  try {
    const payload = await parseBody(request, bodySchema);
    const userId = await resolveCurrentUserId();
    const snapshot = await getStore().moveAssignments({ ...payload, userId });
    return ok(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się przenieść assignmentów.';
    return fail(message, 400);
  }
}
