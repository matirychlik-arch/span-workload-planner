# Debug report: optimistic task UUID bug

- Symptom: dropping a newly created task on the timeline could fail with `invalid input syntax for type uuid: "optimistic-task-..."`.
- Root cause: manual task optimistic UI created a temporary task id that was rendered as draggable before Supabase returned the persisted UUID.
- Fix: optimistic backlog tasks are now shown as pending and cannot be dragged. Drop/preview logic also refuses optimistic ids as a guard.
- Evidence: `npm run build` passed on 2026-06-29.
- Status: DONE.
