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
