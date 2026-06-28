import { ok, fail } from '@/lib/api/http';
import { getStore } from '@/lib/data/store';
import { resolveCurrentUserId } from '@/lib/auth/session';
import { toIsoDate } from '@/lib/domain/time';
import { buildDailyDigest, formatDigestAsSlackMarkdown } from '@/lib/slack/digest';

export async function GET(request: Request) {
  try {
    const userId = await resolveCurrentUserId();
    const url = new URL(request.url);
    const teamId = url.searchParams.get('teamId');
    if (!teamId) return fail('Brakuje teamId.', 400);
    const date = url.searchParams.get('date') ?? toIsoDate(new Date());

    const snapshot = await getStore().getPlannerSnapshot({
      teamId,
      userId,
      from: date,
      to: date
    });

    const digests = buildDailyDigest(snapshot, date).map((digest) => ({
      ...digest,
      slackMarkdown: formatDigestAsSlackMarkdown(digest)
    }));

    return ok({ date, teamId, digests });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Nie udało się wygenerować podglądu digestu.';
    return fail(message, 400);
  }
}
