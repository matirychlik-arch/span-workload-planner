const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { before, beforeEach, after, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
let db;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [workspace, user, team, employee, epic, task, assignment, otherUser, otherEmployee] = [1,2,3,4,5,6,7,8,9].map(id);
const create = (frequency = 'daily', until = null, actor = user) => db.query('select span_create_recurrence($1,$2,$3,$4,$5) as id', [team,actor,assignment,frequency,until]);
const materialize = (from = '2026-09-18', to = '2026-09-23') => db.query('select span_materialize_recurrences($1,$2,$3)', [team,from,to]);
const stop = (a = assignment, actor = user) => db.query('select span_stop_recurrence($1,$2,$3)', [team,actor,a]);
const rows = async () => (await db.query('select *, start_date::text as date from assignments order by start_date')).rows;

before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  // gen_random_uuid is built into PostgreSQL; the test runtime does not need pgcrypto.
  await db.exec(fs.readFileSync(path.join(root,'supabase/schema.sql'),'utf8').replace('create extension if not exists "pgcrypto";', ''));
  const migration = fs.readFileSync(path.join(root,'supabase/recurring-tasks.sql'),'utf8');
  await db.exec(migration);
  await db.exec(migration);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('truncate workspaces cascade');
  await db.query('insert into workspaces(id,name) values ($1,$2)',[workspace,'Test']);
  for (const u of [user,otherUser]) await db.query('insert into app_users(id,workspace_id,email,name) values($1,$2,$3,$4)',[u,workspace,`${u}@example.test`,'Test']);
  await db.query("insert into teams(id,workspace_id,name,pm_user_id,edit_mode) values($1,$2,'Test',$3,'collaborative')",[team,workspace,user]);
  await db.query("insert into team_members(team_id,user_id,role) values($1,$2,'employee')",[team,user]);
  for (const [e,u] of [[employee,user],[otherEmployee,otherUser]]) await db.query("insert into employees(id,workspace_id,team_id,user_id,name) values($1,$2,$3,$4,'Test')",[e,workspace,team,u]);
  await db.query("insert into epics(id,workspace_id,team_id,name,color) values($1,$2,$3,'Green','#008844')",[epic,workspace,team]);
  await db.query("insert into tasks(id,workspace_id,team_id,source,title,epic_id,kind) values($1,$2,$3,'manual','Standup',$4,'meeting')",[task,workspace,team,epic]);
  await db.query("insert into assignments(id,workspace_id,team_id,task_id,employee_id,start_date,start_hour,desired_start_hour,duration_hours,duration_days) values($1,$2,$3,$4,$5,'2026-09-18',10,8,1,1)",[assignment,workspace,team,task,employee]);
});
test('SQL creates one rule, pins original time, materializes idempotently, includes end date', async () => {
  const result = await create('daily','2026-09-21');
  const again = await create('daily','2026-09-21');
  assert.equal(again.rows[0].id,result.rows[0].id);
  await Promise.all([materialize(),materialize()]);
  assert.deepEqual((await rows()).map(r=>r.date),['2026-09-18','2026-09-19','2026-09-20','2026-09-21']);
  assert.ok((await rows()).every(r=>r.start_hour===10 && r.desired_start_hour===10));
});
test('SQL no-end weekdays are generated years later and DST does not shift hours', async () => {
  await create('weekdays'); await materialize('2030-10-25','2030-10-29');
  assert.deepEqual((await rows()).map(r=>r.date),['2026-09-18','2030-10-25','2030-10-28','2030-10-29']);
  assert.ok((await rows()).every(r=>r.start_hour===10));
});
test('SQL moving/deleting one occurrence does not resurrect it', async () => {
  await create(); await materialize();
  await db.exec("delete from assignments where start_date='2026-09-19'; update assignments set start_date='2026-09-24' where start_date='2026-09-20';");
  await materialize();
  assert.deepEqual((await rows()).map(r=>r.date),['2026-09-18','2026-09-21','2026-09-22','2026-09-23','2026-09-24']);
});
test('SQL stop keeps selected and past occurrences, never generates future ones', async () => {
  await create(); await materialize();
  await stop((await rows()).find(r=>r.date==='2026-09-20').id);
  await materialize(); await materialize('2030-09-01','2030-09-10');
  assert.deepEqual((await rows()).map(r=>r.date),['2026-09-18','2026-09-19','2026-09-20']);
});
test('SQL stops a moved occurrence before the original start without resurrecting original', async () => {
  await create(); await materialize();
  await db.query("update assignments set start_date='2026-09-15' where id=$1",[assignment]);
  await stop(); await materialize('2026-09-15','2026-09-23');
  assert.deepEqual((await rows()).map(r=>r.date),['2026-09-15']);
});
test('SQL rejects outsiders, pm-only employees, other employees and invalid rules', async () => {
  await assert.rejects(create('daily',null,otherUser));
  await db.exec("update teams set edit_mode='pm_only'");
  await assert.rejects(create());
  await db.exec("update teams set edit_mode='collaborative'");
  await db.query('update assignments set employee_id=$1',[otherEmployee]);
  await assert.rejects(create());
  await db.query('update assignments set employee_id=$1',[employee]);
  await assert.rejects(create('daily','2026-09-17'));
  await assert.rejects(create('weekly'));
  await db.exec('update assignments set duration_days=2');
  await assert.rejects(create());
  assert.equal((await db.query('select * from assignment_recurrences')).rows.length,0);
});
test('SQL employee cannot stop a series with another employees occurrence; PM can', async () => {
  await create(); await materialize();
  await db.query("update assignments set employee_id=$1 where start_date='2026-09-20'",[otherEmployee]);
  await assert.rejects(stop());
  await db.exec("update team_members set role='pm'; update teams set edit_mode='pm_only';");
  await stop();
  assert.equal((await rows()).length,1);
});
test('SQL anonymous and authenticated users cannot execute privileged functions or access rules', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(create());
      await assert.rejects(materialize());
      await assert.rejects(stop());
      await assert.rejects(db.query('select * from assignment_recurrences'));
    } finally { await db.exec('reset role'); }
  }
});
test('SQL rejects oversized windows and cascades rules with deleted task', async () => {
  await create();
  await assert.rejects(materialize('2026-09-18','2030-09-18'));
  await db.query('delete from tasks where id=$1',[task]);
  await materialize();
  assert.equal((await rows()).length,0);
  assert.equal((await db.query('select * from assignment_recurrences')).rows.length,0);
});
