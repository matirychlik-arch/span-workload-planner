# 2026-09-14 — targeted sticky performance

## Symptom
- Copying/moving a task could freeze the browser for a long time. User reported waiting about a minute with the macOS spinning wheel after copy.

## Root Cause Hypothesis
- Planner mutations recalculated sticky packing for the entire team on both client optimistic update and server mutation.
- `resolveSticky` groups all assignments and performs collision checks per employee. With many assignments and dates, running it for the whole team is too expensive for interactive operations.

## Fix
- Added `resolveStickyForEmployees`, which resolves only touched employees.
- Rewired optimistic client mutations for create, move, copy, resize, and delete to call targeted sticky.
- Rewired Supabase mutations for create, move, copy, resize, delete, and bulk move to call targeted sticky.
- Rewired local store equivalents for consistency.

## Evidence
- `npm run build` passes.
- Local micro-benchmark on 24 employees x 90 days x 4 assignments/day:
  - full sticky: about 3.24s
  - targeted sticky for one employee: about 0.14s

## Remaining Risk
- Mutation endpoints still return a full planner snapshot after save. If production data grows much more, the next optimization should return mutation patches or skip full snapshot replacement when optimistic state is already current.

## Status
DONE_WITH_CONCERNS
