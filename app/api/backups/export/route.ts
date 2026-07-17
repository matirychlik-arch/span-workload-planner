import { getStore } from '@/lib/data/store';
import { fail } from '@/lib/api/http';
import { resolveCurrentUserId } from '@/lib/auth/session';

function backupFileName(): string {
  return `span-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function GET(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const url = new URL(request.url);
    const teamId = url.searchParams.get('teamId');
    if (!teamId) return fail('Brakuje teamId.', 400);

    const backup = await getStore().exportPlannerBackup({ teamId, userId });
    return new Response(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${backupFileName()}"`,
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się pobrać backupu.';
    return fail(message, 400);
  }
}
