import { getStore } from '@/lib/data/store';
import { fail, ok } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const teamId = String(form.get('teamId') ?? '');
    const file = form.get('file');
    if (!teamId) return fail('Brakuje teamId.', 400);
    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return fail('Dodaj plik .xlsx do importu.', 400);
    }

    const upload = file as File;
    const userId = await resolveCurrentUserId();
    const result = await getStore().importFromExcel({
      teamId,
      userId,
      fileName: upload.name,
      data: await upload.arrayBuffer()
    });
    return ok(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się zaimportować Excela.';
    return fail(message, 400);
  }
}
