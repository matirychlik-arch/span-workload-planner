create extension if not exists "pgcrypto";

do $$
declare
  owner_email constant text := 'matirychlik@gmail.com';
  adam_email constant text := 'adam.matysiak@mobilevikings.pl';
  mati_email constant text := 'mateusz.rychlik@mobilevikings.pl';
  pati_email constant text := 'patrycja.lisiecka@mobilevikings.pl';
  marcin_email constant text := 'marcin.luczkowski@mobilevikings.pl';
  karo_email constant text := 'karolina.marciniak@mobilevikings.pl';

  target_workspace_id uuid;
  target_team_id uuid;
  owner_user_id uuid;
begin
  select id, workspace_id
    into owner_user_id, target_workspace_id
    from app_users
   where lower(email) = owner_email
   limit 1;

  if owner_user_id is null or target_workspace_id is null then
    raise exception 'Najpierw zaloguj sie raz jako %, zeby powstal owner workspace.', owner_email;
  end if;

  update workspaces
     set name = 'Mobile Vikings'
   where id = target_workspace_id;

  select id
    into target_team_id
    from teams
   where workspace_id = target_workspace_id
     and lower(name) = lower('Kreatywka')
   limit 1;

  if target_team_id is null then
    insert into teams (workspace_id, name, pm_user_id, edit_mode)
    values (target_workspace_id, 'Kreatywka', owner_user_id, 'collaborative')
    returning id into target_team_id;
  else
    update teams
       set name = 'Kreatywka',
           edit_mode = 'collaborative'
     where id = target_team_id;
  end if;

  insert into team_members (team_id, user_id, role)
  values (target_team_id, owner_user_id, 'admin')
  on conflict (team_id, user_id) do update set role = excluded.role;

  update employees
     set user_id = null,
         active = false
   where workspace_id = target_workspace_id
     and (user_id = owner_user_id or lower(name) = lower('Mateusz Owner'));

  insert into epics (workspace_id, team_id, jira_key, name, color)
  select target_workspace_id, target_team_id, null, 'Manual', '#4A7FF8'
  where not exists (
    select 1 from epics
     where workspace_id = target_workspace_id
       and team_id = target_team_id
       and lower(name) = lower('Manual')
  );

  insert into employees (workspace_id, team_id, user_id, name, active, tint_color)
  select target_workspace_id, target_team_id, null, employee_name, true, tint_color
    from (
      values
        ('Marcin - grafik', '#F6EFE8'),
        ('Mati - grafik', '#EEF3FF'),
        ('Pati - copywriterka', '#EEF7EF'),
        ('Adam - traffic', '#F2EDFA')
    ) as employee_seed(employee_name, tint_color)
   where not exists (
     select 1 from employees
      where workspace_id = target_workspace_id
        and team_id = target_team_id
        and lower(name) = lower(employee_seed.employee_name)
   );

  insert into workspace_invites (workspace_id, team_id, email, name, role, employee_name, tint_color, active)
  values
    (target_workspace_id, target_team_id, lower(adam_email), 'Adam', 'pm', 'Adam - traffic', '#F2EDFA', true),
    (target_workspace_id, target_team_id, lower(mati_email), 'Mati', 'employee', 'Mati - grafik', '#EEF3FF', true),
    (target_workspace_id, target_team_id, lower(pati_email), 'Pati', 'employee', 'Pati - copywriterka', '#EEF7EF', true),
    (target_workspace_id, target_team_id, lower(marcin_email), 'Marcin', 'employee', 'Marcin - grafik', '#F6EFE8', true),
    (target_workspace_id, target_team_id, lower(karo_email), 'Karo', 'pm', null, null, true)
  on conflict (lower(email)) where active = true do update set
    workspace_id = excluded.workspace_id,
    team_id = excluded.team_id,
    name = excluded.name,
    role = excluded.role,
    employee_name = excluded.employee_name,
    tint_color = excluded.tint_color,
    active = true;
end $$;
