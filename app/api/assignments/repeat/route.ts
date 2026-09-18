import { z } from 'zod';
import { getStore } from '@/lib/data/store';
import { fail, ok, parseBody } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';
import { validCalendarDate } from '@/lib/domain/recurrence';

const identifiers = z.object({ teamId: z.string().min(1), assignmentId: z.string().min(1) });
const createSchema = identifiers.extend({
  frequency: z.enum(['daily', 'weekdays']),
  until: z.string().refine(validCalendarDate).nullable()
});

export async function POST(request: Request) {
  try {
    const params = await parseBody(request, createSchema);
    return ok(await getStore().repeatAssignment({ ...params, userId: await resolveCurrentUserId() }));
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Nie udało się utworzyć cyklu.', 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const params = await parseBody(request, identifiers);
    return ok(await getStore().stopRecurrence({ ...params, userId: await resolveCurrentUserId() }));
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Nie udało się zakończyć cyklu.', 400);
  }
}
