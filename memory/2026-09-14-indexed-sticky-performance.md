# 2026-09-14: indexed sticky and copy preview performance

## Symptom and root cause

Copying or moving a block can freeze the browser for approximately a minute.
The preceding fix (5b3deae) limits packing to affected employees but still scans
their entire history for every collision. At a saturated day's final hour,
pushAfter cannot move the block further. The old guard repeats the identical
collision up to employee assignment count + 2 times for every saturated block.
This produces cubic worst-case work and repeated date parsing on the UI thread.

## Fix

- Index occupied hours per employee/calendar day, storing the maximum blocker end
  for each hour. Collision lookup is bounded by the block span, not history size.
- Stop immediately when pushAfter reaches a fixed point. Existing placement,
  duration normalization, ordering and pinned behavior are preserved.
- In PlannerApp, index assignments by ID and cache the copied drag context until
  the clipboard array or assignment map changes. Group drop previews by cell.
- No changes to persistence, authorization or server concurrency behavior.

## Verification

- npm run build: passed (including TypeScript check).
- tests/sticky.test.cjs: 8 passing regressions, runnable via npm test.
- 180 seeded differential scenarios compared all three sticky entry points with
  5b3deae: exact output equality. Includes pinning, mixed employees, multi-day
  spans, normalization, saturation and dates around the Warsaw DST transition.
- Saturation regression with 100 blocks: old implementation 1583.54 ms (fails
  500 ms budget), new 0.18 ms (passes), identical output.
- Isolated algorithm measurement with 300 saturated blocks: old 45237 ms,
  new 0.52 ms. New engine with 3000 saturated blocks: 5.45 ms.
- 360 blocks across 90 days: old 185 ms, new 0.39 ms.
- Local production build in Chromium at 1440 x 1000, 300 saturated historical
  blocks plus visible tasks: copying two blocks completed in 48.4 ms with a
  mocked API. Both highlighted cells, clipboard replacement and removal of a
  copied source were verified. No browser page errors. External requests were
  blocked; no production data was used or changed.
- Browser harness: /tmp/span-browser-check.cjs; screenshot:
  /tmp/span-performance-check.png (temporary local verification artifacts).

## Astra review and remaining work

A separate gpt-6-astra review confirmed further opportunities:

1. Mutations run ensureUserWorkspaceAndSeed for established users. Account and
   membership reconciliation introduces serial database requests. Move it to an
   appropriate authentication/onboarding flow only with access regression tests.
2. The serial mutation queue acknowledges optimistic copies only after the last
   pending write. Incremental ID reconciliation needs careful replay of later
   edits; simply parallelizing writes risks lost updates.
3. Server responses return complete snapshots; the render index includes history
   outside the visible window. Window filtering must preserve backlog semantics.
4. Preview changes still render the full grid. Memoized rows/preview layers are a
   possible next step if browser profiling shows material rendering cost.

The measured millisecond figures are local CPU/mock-API results, not production
Supabase latency. The existing overflow behavior (clipping and overlapping at
15:00 when no space remains) is preserved; changing that policy is separate work.

Status: DONE_WITH_CONCERNS (local verification passed; production latency unmeasured).
