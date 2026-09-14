# 2026-09-14: planner save latency

## Symptom and investigation

User still reports a long pause after copying following the CPU and preview fixes.
New copies remain pending until the serialized server write returns. Reading the
copy path confirmed account reconciliation on every mutation, including auth
profile lookup, invite lookup, user upsert, membership updates and employee
linking. The response then reread team permissions and initialized the palette.

## Change

- Copy, move, resize, create assignment, delete assignment and bulk move check
  fresh team membership and edit mode without re-provisioning the account.
- Initial team/planner loading still performs account/invite reconciliation.
- Team and membership reads run concurrently. Their verified context is reused
  for the response within that single request, never across requests or users.
- Mutation snapshots do not initialize palette data; initial load still does.
- Bulk moves validate unique destinations rather than each selected block.
- Move/copy ID lookups use sets; bulk move reuses its ID map.
- Persistence order, changed-record writes, frontend queue and response schema
  are unchanged. Production data and credentials were not accessed.

## Evidence

Using the actual old/current SupabaseStore code with an in-memory Supabase query
fixture, existing invited employee, one independent copy, 50 ms per query:

| Measurement | Before (1d41baa) | After |
| --- | --- | --- |
| Total queries including auth | 27 | 15 |
| Account/member/employee writes | 3 | 0 |
| End-to-end store call | 1134 ms | 463 ms |

These are simulated network results, not measurements against production Supabase.
The query-count regression expects one team/member read per mutation; old code
performed repeated reads and provisioning writes and fails that expectation.

Tests cover all six optimized operations, employee ownership, membership removal,
PM-only teams, foreign destinations, independent/linked copies, saved description
and color, permission-query failures, changed ownership and role demotion on a
reused store instance, bulk destination deduplication and initial invite setup.

Validation: npm test (44 tests) and npm run build. See tests/supabase-planner.test.cjs
and tests/helpers/supabase-fixture.cjs. The fixture forbids real database creation.

## Remaining limitations

The API still returns full snapshots and copies remain non-editable until their
server-generated IDs arrive. Per-copy acknowledgement in the mutation queue and
atomic writes/version conflict handling are separate work, not solved here.
Initial loading still reconciles invitations as before. Actual production latency
has not been profiled, so deploy and measure before attributing all remaining
delay to the database. No guarantee of instantaneous saves on a slow connection.

Status: DONE_WITH_CONCERNS (verified locally, not deployed).
