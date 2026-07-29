-- Usuwa tylko taski z backlogu dla Mobile Vikings / Kreatywka.
-- Task w backlogu = task bez zadnego assignmentu na osi czasu.

with target_team as (
  select
    workspaces.id as workspace_id,
    teams.id as team_id
  from workspaces
  join teams on teams.workspace_id = workspaces.id
  where lower(workspaces.name) = lower('Mobile Vikings')
    and lower(teams.name) = lower('Kreatywka')
  limit 1
)
delete from tasks
using target_team
where tasks.workspace_id = target_team.workspace_id
  and tasks.team_id = target_team.team_id
  and not exists (
    select 1
    from assignments
    where assignments.team_id = target_team.team_id
      and assignments.task_id = tasks.id
  );
