import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { backupPath, exportWorkspaceBackup, shouldRunScheduledBackup, uploadPlannerBackup } from '@/lib/backups/cloud';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

async function runScheduledBackups() {
  const client = createSupabaseAdminClient();
  const { data: workspaces, error } = await client.from('workspaces').select('id');
  if (error) throw new Error(error.message);

  const saved: string[] = [];
  for (const workspace of workspaces ?? []) {
    const workspaceId = String(workspace.id);
    const backup = await exportWorkspaceBackup(client, workspaceId);
    if (!backup) continue;
    const path = await uploadPlannerBackup(client, backup, backupPath(workspaceId));
    saved.push(path);
  }
  return saved;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!shouldRunScheduledBackup()) {
    return Response.json({ ok: true, skipped: true, reason: 'Poza godzinami 12:00/17:00 Europe/Warsaw' });
  }

  try {
    const saved = await runScheduledBackups();
    return Response.json({ ok: true, saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się wykonać backupu.';
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
