-- Run once in Supabase SQL Editor before deploying recurrence support.
begin;
alter table public.tasks add column if not exists kind text not null default 'task'
  check (kind in ('task', 'meeting'));

create table if not exists public.assignment_recurrences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  start_date date not null,
  start_hour integer not null check (start_hour between 8 and 15),
  duration_hours integer not null check (duration_hours between 1 and 8 and start_hour + duration_hours <= 16),
  frequency text not null check (frequency in ('daily', 'weekdays')),
  until_date date check (until_date is null or until_date >= start_date),
  -- Keep dates even after deleting/moving an occurrence: it must not reappear.
  generated_dates date[] not null default '{}'
);
alter table public.assignment_recurrences enable row level security;
revoke all on public.assignment_recurrences from anon, authenticated;
grant all on public.assignment_recurrences to service_role;
create index if not exists recurrence_team_idx on public.assignment_recurrences(team_id);
alter table public.assignments add column if not exists recurrence_id uuid
  references public.assignment_recurrences(id) on delete set null;
create index if not exists assignment_recurrence_idx on public.assignments(recurrence_id);

create or replace function public.span_materialize_recurrences(p_team uuid, p_from date, p_to date)
returns void language plpgsql security invoker set search_path = public as $$
declare r public.assignment_recurrences%rowtype; d date; original_count integer;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 120 then
    raise exception 'Invalid calendar range';
  end if;
  for r in select ar.* from public.assignment_recurrences ar
    join public.employees e on e.id = ar.employee_id and e.active = true
    where ar.team_id = p_team and ar.start_date <= p_to
      and (ar.until_date is null or ar.until_date >= p_from)
    order by ar.id for update of ar
  loop
    original_count := cardinality(r.generated_dates);
    for d in select greatest(r.start_date, p_from) + n
      from generate_series(0, least(coalesce(r.until_date, p_to), p_to) - greatest(r.start_date, p_from)) n
    loop
      if d = any(r.generated_dates) or (r.frequency = 'weekdays' and extract(isodow from d) > 5) then continue; end if;
      insert into public.assignments(workspace_id, team_id, task_id, employee_id,
        start_date, start_hour, desired_start_hour, duration_hours, duration_days, recurrence_id)
      values(r.workspace_id, r.team_id, r.task_id, r.employee_id, d, r.start_hour, r.start_hour, r.duration_hours, 1, r.id);
      r.generated_dates := array_append(r.generated_dates, d);
    end loop;
    if cardinality(r.generated_dates) > original_count then
      update public.assignment_recurrences set generated_dates = r.generated_dates where id = r.id;
    end if;
  end loop;
end; $$;

create or replace function public.span_create_recurrence(p_team uuid, p_user uuid, p_assignment uuid, p_frequency text, p_until date)
returns uuid language plpgsql security invoker set search_path = public as $$
declare a public.assignments%rowtype; role_name text; edit_mode_name text; rule_id uuid;
begin
  select m.role, t.edit_mode into role_name, edit_mode_name from public.team_members m
    join public.teams t on t.id = m.team_id where m.team_id = p_team and m.user_id = p_user;
  if role_name is null or (role_name = 'employee' and edit_mode_name <> 'collaborative') then raise exception 'Brak uprawnien do edycji zespolu'; end if;
  select * into a from public.assignments where id = p_assignment and team_id = p_team for update;
  if not found then raise exception 'Nie znaleziono taska'; end if;
  if not exists(select 1 from public.employees e where e.id = a.employee_id and e.team_id = p_team and e.active
    and (role_name <> 'employee' or e.user_id = p_user)) then raise exception 'Brak uprawnien do pracownika'; end if;
  if a.recurrence_id is not null then return a.recurrence_id; end if;
  if a.duration_days <> 1 or p_frequency not in ('daily', 'weekdays') or p_frequency is null
    or (p_until is not null and p_until < a.start_date) then raise exception 'Nieprawidlowa regula powtarzania'; end if;
  insert into public.assignment_recurrences(workspace_id, team_id, task_id, employee_id,
    start_date, start_hour, duration_hours, frequency, until_date, generated_dates)
  values(a.workspace_id, a.team_id, a.task_id, a.employee_id, a.start_date,
    a.start_hour, a.duration_hours, p_frequency, p_until, array[a.start_date]) returning id into rule_id;
  update public.assignments set recurrence_id = rule_id, desired_start_hour = start_hour, version = version + 1 where id = a.id;
  return rule_id;
end; $$;

create or replace function public.span_stop_recurrence(p_team uuid, p_user uuid, p_assignment uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare a public.assignments%rowtype; r public.assignment_recurrences%rowtype; role_name text; edit_mode_name text;
begin
  select m.role, t.edit_mode into role_name, edit_mode_name from public.team_members m
    join public.teams t on t.id = m.team_id where m.team_id = p_team and m.user_id = p_user;
  if role_name is null or (role_name = 'employee' and edit_mode_name <> 'collaborative') then raise exception 'Brak uprawnien do edycji zespolu'; end if;
  select * into a from public.assignments where id = p_assignment and team_id = p_team;
  if not found or a.recurrence_id is null then raise exception 'Nie znaleziono cyklu'; end if;
  select * into r from public.assignment_recurrences where id = a.recurrence_id and team_id = p_team for update;
  if not found then raise exception 'Nie znaleziono cyklu'; end if;
  if role_name = 'employee' and (
    not exists(select 1 from public.employees where id = r.employee_id and user_id = p_user and active)
    or exists(select 1 from public.assignments x join public.employees e on e.id = x.employee_id
      where x.recurrence_id = r.id and (e.user_id is distinct from p_user or not e.active)))
  then raise exception 'Nie mozna zmienic cyklu innych pracownikow'; end if;
  -- A moved exception before the first date can still end the series safely.
  update public.assignment_recurrences set until_date = greatest(start_date, least(coalesce(until_date, a.start_date), a.start_date)) where id = r.id;
  delete from public.assignments where recurrence_id = r.id and start_date > a.start_date;
end; $$;

revoke all on function public.span_materialize_recurrences(uuid,date,date) from public, anon, authenticated;
revoke all on function public.span_create_recurrence(uuid,uuid,uuid,text,date) from public, anon, authenticated;
revoke all on function public.span_stop_recurrence(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.span_materialize_recurrences(uuid,date,date) to service_role;
grant execute on function public.span_create_recurrence(uuid,uuid,uuid,text,date) to service_role;
grant execute on function public.span_stop_recurrence(uuid,uuid,uuid) to service_role;
commit;
