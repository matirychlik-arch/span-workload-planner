# 2026-09-14 — copy modes, palette cleanup, planner performance

## Symptom
- Copied tasks were always linked to the original task record, so editing title, description, or color on one instance changed other instances.
- Task color menu showed too many historical colors, mostly blue-like duplicates, because it rendered every `epic` row.
- Planner felt laggy during hover/drop/copy interactions and with larger boards.

## Root cause
- `copyAssignments` copied assignments only and kept the same `taskId`.
- Color picker used `snapshot.epics` directly instead of a curated palette.
- Timeline render computed day cell assignments by filtering the full assignment list for every employee/day cell; hover preview also updated React state on repeated mouse events even when the target had not changed.

## Fix
- Added `linkTasks` to copy API/store contract. Default copy creates separate cloned task rows; linked copy keeps the same `taskId`.
- Added UI toggle: `Kopie: osobne/połączone`, defaulting to separate copies.
- Limited color picker to system palette entries and expanded the seed palette to 12 distinct colors.
- Indexed assignments by `employeeId|date` before rendering cells.
- Added drop-preview target memoization to avoid redundant hover state updates.

## Evidence
- `npm run build` passes.

## Status
DONE_WITH_CONCERNS

## Follow-up
- If lag remains on production data, next target is backend response size and replacing full snapshot returns after mutations with smaller patch responses.
