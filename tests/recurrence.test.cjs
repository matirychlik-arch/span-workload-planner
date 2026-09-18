const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule, loadStore, fixture } = require('./helpers/supabase-fixture.cjs');
const { recurrenceDates, validCalendarDate, validateRecurrence, recurrenceToRow, recurrenceFromRow } = loadModule('lib/domain/recurrence.ts');
const { LocalStore } = loadModule('lib/data/local-store.ts');
const { resolveStickyForEmployee } = loadModule('lib/domain/sticky.ts');
const { readAllRows } = loadModule('lib/data/read-all-rows.ts');
const rule = { id: 'r', workspaceId: 'w', teamId: 't', taskId: 'task', employeeId: 'e', startDate: '2026-09-18', startHour: 10, durationHours: 1, frequency: 'daily', until: null, generatedDates: [] };

test('daily supports no end, inclusive end, weekdays, and deleted occurrence tombstones', () => {
  assert.deepEqual(recurrenceDates(rule, '2026-09-18', '2026-09-21'), ['2026-09-18','2026-09-19','2026-09-20','2026-09-21']);
  assert.deepEqual(recurrenceDates({ ...rule, frequency: 'weekdays' }, '2026-09-18', '2026-09-21'), ['2026-09-18','2026-09-21']);
  assert.deepEqual(recurrenceDates({ ...rule, until: '2026-09-19', generatedDates: ['2026-09-18'] }, '2026-09-17', '2026-09-21'), ['2026-09-19']);
  assert.deepEqual(recurrenceDates(rule, '2036-09-18', '2036-09-19'), ['2036-09-18','2036-09-19']);
  assert.deepEqual(recurrenceFromRow(recurrenceToRow(rule)), rule);
});
test('recurrence dates stay continuous at DST, leap day and year boundary', () => {
  for (const [from, to, expected] of [
    ['2026-03-28','2026-03-30',['2026-03-28','2026-03-29','2026-03-30']],
    ['2026-10-24','2026-10-26',['2026-10-24','2026-10-25','2026-10-26']],
    ['2028-02-28','2028-03-01',['2028-02-28','2028-02-29','2028-03-01']],
    ['2026-12-31','2027-01-02',['2026-12-31','2027-01-01','2027-01-02']]
  ]) assert.deepEqual(recurrenceDates({ ...rule, startDate: from }, from, to), expected);
});
test('weekly recurrence keeps its original weekday across DST, windows and end dates', () => {
  const weekly = { ...rule, frequency: 'weekly', startDate: '2026-10-18' };
  assert.deepEqual(recurrenceDates(weekly, '2026-10-19', '2026-11-02'), ['2026-10-25','2026-11-01']);
  assert.deepEqual(recurrenceDates({ ...weekly, until: '2026-10-25' }, '2026-10-19', '2026-11-02'), ['2026-10-25']);
  assert.deepEqual(recurrenceDates({ ...weekly, generatedDates: ['2026-10-25'] }, '2026-10-19', '2026-11-02'), ['2026-11-01']);
  assert.deepEqual(recurrenceDates({ ...weekly, startDate: '2026-12-25' }, '2026-12-26', '2027-01-09'), ['2027-01-01','2027-01-08']);
});
test('monthly recurrence clamps short months without drifting its original date', () => {
  const monthly = { ...rule, frequency: 'monthly', startDate: '2027-01-31' };
  assert.deepEqual(recurrenceDates(monthly, '2027-01-31', '2027-04-30'), ['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
  assert.deepEqual(recurrenceDates(monthly, '2028-02-01', '2028-03-31'), ['2028-02-29','2028-03-31']);
  assert.deepEqual(recurrenceDates({ ...monthly, until:'2027-02-28' }, '2027-02-01', '2027-03-31'), ['2027-02-28']);
  assert.deepEqual(recurrenceDates({ ...monthly, generatedDates:['2027-02-28'] }, '2027-02-01', '2027-03-31'), ['2027-03-31']);
  assert.deepEqual(recurrenceDates({ ...monthly, startDate:'2026-12-15' }, '2026-12-16', '2027-02-15'), ['2027-01-15','2027-02-15']);
});
test('invalid dates, unbounded request windows and multi-day cycles are rejected', () => {
  assert.equal(validCalendarDate('2026-02-30'), false);
  assert.equal(validCalendarDate('2028-02-29'), true);
  assert.throws(() => recurrenceDates(rule, '2026-09-18', '2027-09-18'));
  assert.throws(() => validateRecurrence('2026-09-18', 2, null));
  assert.throws(() => validateRecurrence('2026-09-18', 1, '2026-09-17'));
});

function localFixture() {
  const store = new LocalStore();
  store.state = {
    workspace: { id: 'w', name: 'Test' }, users: [{ id: 'u', workspaceId: 'w', email: 'test@example.test', name: 'Test' }],
    teams: [{ id: 't', workspaceId: 'w', pmUserId: 'u', name: 'Test', editMode: 'collaborative' }],
    teamMembers: [{ teamId: 't', userId: 'u', role: 'admin' }],
    employees: [{ id: 'e', workspaceId: 'w', teamId: 't', userId: 'u', name: 'Test', active: true }],
    epics: [{ id: 'ep', workspaceId: 'w', teamId: 't', name: 'Green', color: '#008844' }],
    tasks: [{ id: 'task', workspaceId: 'w', teamId: 't', title: 'Standup', kind: 'meeting', source: 'manual', epicId: 'ep' }],
    assignments: [{ id: 'a', workspaceId: 'w', teamId: 't', taskId: 'task', employeeId: 'e', startDate: '2026-09-18', startHour: 10, desiredStartHour: 8, durationHours: 1, durationDays: 1, version: 1, updatedAt: new Date().toISOString() }], recurrences: []
  };
  return store;
}
const actor = { teamId: 't', userId: 'u' };
test('local cycles survive deletion, lazy generation, ordinary copy, backup and stop', async () => {
  const store = localFixture();
  let snapshot = await store.repeatAssignment({ ...actor, assignmentId: 'a', frequency: 'weekdays', until: null });
  assert.equal(snapshot.recurrences.length, 1);
  assert.equal(snapshot.assignments.find(a => a.id === 'a').desiredStartHour, 10);
  const occurrence = snapshot.assignments.find(a => a.startDate === '2026-09-21');
  await store.deleteAssignments({ ...actor, assignmentIds: [occurrence.id] });
  snapshot = await store.getPlannerSnapshot({ ...actor, from: '2026-09-18', to: '2026-09-25' });
  assert.ok(!snapshot.assignments.some(a => a.startDate === '2026-09-21'));
  snapshot = await store.copyAssignments({ ...actor, assignmentIds: ['a'], anchorAssignmentId: 'a', targetEmployeeId: 'e', targetDate: '2026-09-19', targetStartHour: 10, linkTasks: false });
  const copy = snapshot.assignments.find(a => a.startDate === '2026-09-19');
  assert.equal(copy.recurrenceId, undefined);
  assert.notEqual(copy.taskId, 'task');
  assert.equal(snapshot.tasks.find(t => t.id === copy.taskId).kind, 'meeting');
  const backup = await store.exportPlannerBackup(actor);
  const restored = localFixture();
  await restored.restorePlannerBackup({ ...actor, backup });
  snapshot = await restored.getPlannerSnapshot({ ...actor, from: '2027-09-20', to: '2027-09-21' });
  assert.ok(snapshot.assignments.some(a => a.startDate === '2027-09-20'));
  assert.ok(!snapshot.assignments.some(a => a.startDate === '2026-09-21'));
  const cutoff = snapshot.assignments.find(a => a.startDate === '2026-09-22');
  await restored.stopRecurrence({ ...actor, assignmentId: cutoff.id });
  snapshot = await restored.getPlannerSnapshot({ ...actor, from: '2027-09-20', to: '2027-09-21' });
  assert.ok(!snapshot.assignments.some(a => a.recurrenceId && a.startDate > '2026-09-22'));
});
test('local task deletion removes its rule so it cannot generate ghost tasks', async () => {
  const store = localFixture();
  await store.repeatAssignment({ ...actor, assignmentId: 'a', frequency: 'daily', until: null });
  await store.deleteTasks({ ...actor, taskIds: ['task'] });
  const snapshot = await store.getPlannerSnapshot({ ...actor, from: '2027-09-20', to: '2027-09-21' });
  assert.equal(snapshot.assignments.length, 0);
  assert.equal(snapshot.recurrences.length, 0);
});
test('recurring appointments keep their clock time during sticky packing', () => {
  const [a] = localFixture().state.assignments;
  const result = resolveStickyForEmployee([
    { ...a, id: 'meeting', startHour: 10, desiredStartHour: 10, recurrenceId: 'r' },
    { ...a, id: 'task', startHour: 9, desiredStartHour: 9, durationHours: 2 }
  ], 'task');
  assert.equal(result.find(a => a.id === 'meeting').startHour, 10);
  assert.equal(result.find(a => a.id === 'task').startHour, 11);
});
test('Supabase normal copy preserves meeting type but not the source series', async () => {
  const f = fixture();
  f.db.tasks[0].kind = 'meeting'; f.db.assignments[0].recurrence_id = 'r';
  const Store = loadStore(); const store = new Store(f.client);
  const snapshot = await store.copyAssignments({ teamId: 't', userId: 'user-1', assignmentIds: ['a'], anchorAssignmentId: 'a', targetEmployeeId: 'e1', targetDate: '2026-09-15', targetStartHour: 8, linkTasks: false });
  const copy = snapshot.assignments.find(a => a.id !== 'a');
  assert.equal(copy.recurrenceId, undefined);
  assert.equal(snapshot.tasks.find(t => t.id === copy.taskId).kind, 'meeting');
});

test('long recurring history is read beyond 1,000 rows; a failed page is never treated as complete', async () => {
  const data = Array.from({length:1201},(_,id)=>({id}));
  const result = await readAllRows((from,to)=>Promise.resolve({ data:data.slice(from,to+1),error:null }));
  assert.deepEqual(result.data,data);
  const failed = await readAllRows((from,to)=>Promise.resolve(from ? {data:null,error:{message:'Offline'}} : {data:data.slice(from,to+1),error:null}));
  assert.equal(failed.data,null);
  assert.equal(failed.error.message,'Offline');
});
test('cloud and manual backups preserve all 1,201 occurrences, meeting kind and rule tombstones', async () => {
  const f = fixture({role:'admin'});
  f.db.tasks[0].kind = 'meeting';
  const original = f.db.assignments[0];
  f.db.assignments = Array.from({length:1201},(_,i)=>({...original,id:'a'+i,recurrence_id:'r'}));
  f.db.assignment_recurrences.push(recurrenceToRow({...rule,employeeId:'e1',generatedDates:['2026-09-18','2026-09-19']}));
  const Store = loadStore();
  const {exportWorkspaceBackup} = loadModule('lib/backups/cloud.ts');
  for(const backup of [await new Store(f.client).exportPlannerBackup({teamId:'t',userId:'user-1'}),await exportWorkspaceBackup(f.client,'w')]) {
    assert.equal(backup.assignments.length,1201);
    assert.equal(backup.tasks[0].kind,'meeting');
    assert.ok(backup.assignments.every(a=>a.recurrenceId==='r'));
    assert.deepEqual(backup.recurrences[0].generatedDates,['2026-09-18','2026-09-19']);
  }
});
