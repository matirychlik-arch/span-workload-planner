create extension if not exists "pgcrypto";

alter table epics
  add column if not exists team_id uuid references teams(id) on delete cascade;

alter table tasks
  add column if not exists team_id uuid references teams(id) on delete cascade;

drop index if exists epics_workspace_jira_key_uidx;
drop index if exists tasks_workspace_jira_issue_uidx;
drop index if exists tasks_workspace_jira_key_uidx;

create unique index if not exists epics_team_jira_key_uidx
  on epics(team_id, jira_key)
  where jira_key is not null;

create unique index if not exists tasks_team_jira_issue_uidx
  on tasks(team_id, jira_issue_id)
  where jira_issue_id is not null;

create unique index if not exists tasks_team_jira_key_uidx
  on tasks(team_id, jira_key)
  where jira_key is not null;

do $$
declare
  target_workspace_id uuid;
begin
  select workspace_id
    into target_workspace_id
    from app_users
   where lower(email) = 'matirychlik@gmail.com'
   limit 1;

  if target_workspace_id is null then
    raise notice 'Nie znaleziono workspace dla matirychlik@gmail.com.';
    return;
  end if;

  delete from assignments where workspace_id = target_workspace_id;
  delete from tasks where workspace_id = target_workspace_id;
  delete from employees where workspace_id = target_workspace_id;
  delete from team_members
   where team_id in (select id from teams where workspace_id = target_workspace_id);
  delete from teams where workspace_id = target_workspace_id;
  delete from epics where workspace_id = target_workspace_id;
end $$;
