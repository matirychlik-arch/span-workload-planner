create extension if not exists "pgcrypto";

do $$
declare
  owner_email constant text := 'matirychlik@gmail.com';
  work_email constant text := 'mateusz.rychlik@mobilevikings.pl';
  owner_user_id uuid;
  work_user_id uuid;
  target_workspace_id uuid;
  target_team_id uuid;
begin
  select id, workspace_id
    into owner_user_id, target_workspace_id
    from app_users
   where lower(email) = owner_email
   limit 1;

  if owner_user_id is null or target_workspace_id is null then
    raise exception 'Nie znaleziono ownera % w app_users.', owner_email;
  end if;

  select id
    into target_team_id
    from teams
   where workspace_id = target_workspace_id
     and lower(name) = lower('Kreatywka')
   limit 1;

  if target_team_id is null then
    raise exception 'Nie znaleziono teamu Kreatywka w workspace ownera.';
  end if;

  update employees
     set user_id = null
   where workspace_id = target_workspace_id
     and user_id = owner_user_id;

  insert into team_members (team_id, user_id, role)
  values (target_team_id, owner_user_id, 'admin')
  on conflict (team_id, user_id) do update set role = excluded.role;

  insert into workspace_invites (workspace_id, team_id, email, name, role, employee_name, tint_color, active)
  values (target_workspace_id, target_team_id, work_email, 'Mati', 'employee', 'Mati - grafik', '#EEF3FF', true)
  on conflict (lower(email)) where active = true do update set
    workspace_id = excluded.workspace_id,
    team_id = excluded.team_id,
    name = excluded.name,
    role = excluded.role,
    employee_name = excluded.employee_name,
    tint_color = excluded.tint_color,
    active = true;

  insert into employees (workspace_id, team_id, user_id, name, active, tint_color)
  select target_workspace_id, target_team_id, null, 'Mati - grafik', true, '#EEF3FF'
  where not exists (
    select 1 from employees
     where workspace_id = target_workspace_id
       and team_id = target_team_id
       and lower(name) = lower('Mati - grafik')
  );

  select id
    into work_user_id
    from app_users
   where lower(email) = work_email
     and workspace_id = target_workspace_id
   limit 1;

  if work_user_id is not null then
    insert into team_members (team_id, user_id, role)
    values (target_team_id, work_user_id, 'employee')
    on conflict (team_id, user_id) do update set role = excluded.role;

    update employees
       set user_id = work_user_id,
           active = true,
           tint_color = coalesce(tint_color, '#EEF3FF')
     where workspace_id = target_workspace_id
       and team_id = target_team_id
       and lower(name) = lower('Mati - grafik');
  end if;
end $$;
