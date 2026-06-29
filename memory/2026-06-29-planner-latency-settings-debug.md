# Debug report: planner latency and settings management

- Symptom: creating tasks, dropping blocks, resizing and other planner actions felt delayed. Settings opened but did not allow managing teams or employees.
- Root cause: planner mutations waited for API + Supabase + sticky packing + full snapshot response before the UI changed. Settings modal was read-only and had no backend endpoints for team/employee management.
- Fix: added optimistic UI for assignment create/move/copy/resize/delete and manual task creation. Added team settings, team creation, employee creation, employee update and employee deactivation endpoints/store methods. Updated settings modal into an editable management panel.
- Evidence: `npm run build` passed on 2026-06-29.
- Status: DONE.
