create extension if not exists "pgcrypto";

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  google_auth_enabled boolean not null default true,
  jira_connected boolean not null default false,
  slack_connected boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email text not null,
  name text not null,
  google_sub text,
  slack_user_id text,
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  pm_user_id uuid not null references app_users(id) on delete restrict,
  edit_mode text not null check (edit_mode in ('collaborative', 'pm_only')),
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null check (role in ('admin', 'pm', 'employee')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  name text not null,
  active boolean not null default true,
  tint_color text,
  created_at timestamptz not null default now()
);

create table if not exists epics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  jira_key text,
  name text not null,
  color text not null,
  created_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null check (source in ('jira', 'manual')),
  jira_issue_id text,
  jira_key text,
  title text not null,
  url text,
  epic_id uuid not null references epics(id) on delete restrict,
  status text,
  assignee_id uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  start_date date not null,
  start_hour integer not null check (start_hour between 7 and 18),
  desired_start_hour integer not null check (desired_start_hour between 7 and 18),
  duration_hours integer not null check (duration_hours between 1 and 12),
  duration_days integer not null check (duration_days between 1 and 10),
  completion_ratio numeric,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists assignments_team_employee_date_idx
  on assignments(team_id, employee_id, start_date);

create unique index if not exists epics_workspace_jira_key_uidx
  on epics(workspace_id, jira_key)
  where jira_key is not null;

create unique index if not exists tasks_workspace_jira_issue_uidx
  on tasks(workspace_id, jira_issue_id)
  where jira_issue_id is not null;

create unique index if not exists tasks_workspace_jira_key_uidx
  on tasks(workspace_id, jira_key)
  where jira_key is not null;

create or replace function set_assignments_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_assignments_updated_at on assignments;
create trigger trg_assignments_updated_at
before update on assignments
for each row execute procedure set_assignments_updated_at();

alter table workspaces enable row level security;
alter table app_users enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;
alter table employees enable row level security;
alter table epics enable row level security;
alter table tasks enable row level security;
alter table assignments enable row level security;
