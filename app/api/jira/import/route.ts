import { z } from 'zod';
import { getStore } from '@/lib/data/store';
import { fail, ok, parseBody } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

const bodySchema = z.object({
  teamId: z.string().min(1),
  jql: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const payload = await parseBody(request, bodySchema);
    const userId = await resolveCurrentUserId();
    const result = await getStore().importFromJira({ ...payload, userId });
    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się zaimportować z Jiry.';
    return fail(message, 400);
  }
}
