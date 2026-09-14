const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadStore, fixture } = require('./helpers/supabase-fixture.cjs');
const Store = loadStore();
const base = { teamId: 't', userId: 'user-1' };
const copy = { ...base, assignmentIds: ['a'], anchorAssignmentId: 'a', targetEmployeeId: 'e1', targetDate: '2026-09-15', targetStartHour: 8 };
const operations = {
  copyAssignments: copy,
  moveAssignments: copy,
  resizeAssignment: { ...base, assignmentId: 'a', durationHours: 3 },
  createAssignment: { ...base, taskId: 'task', employeeId: 'e1', startDate: '2026-09-15', startHour: 8 },
  deleteAssignments: { ...base, assignmentIds: ['a'] },
  bulkMoveAssignments: { ...base, moves: [{ assignmentId: 'a', employeeId: 'e1', date: '2026-09-15', startHour: 8 }] }
};
const writes = (f) => f.calls.filter((call) => ['insert', 'update', 'upsert', 'delete'].includes(call.action));

for (const [method, params] of Object.entries(operations)) {
  test(`${method}: employee edits own blocks without account or palette synchronization`, async () => {
    const f = fixture();
    const result = await new Store(f.client)[method](params);
    assert.equal(result.currentRole, 'employee');
    assert.equal(result.canEdit, true);
    assert.equal(f.calls.filter((call) => call.table === 'team_members').length, 1);
    assert.equal(f.calls.filter((call) => call.table === 'teams').length, 1);
    assert.equal(f.calls.filter((call) => call.table === 'epics').length, 1);
    assert.ok(!f.calls.some((call) => call.table === 'auth' || call.table === 'workspace_invites'));
    assert.ok(writes(f).every((call) => ['tasks', 'assignments'].includes(call.table)));
    assert.ok(writes(f).length > 0);
  });

  for (const mode of ['no-membership', 'pm_only', 'foreign-block']) {
    test(`${method}: rejects ${mode} before any write`, async () => {
      const f = fixture({ role: mode === 'no-membership' ? null : 'employee', mode: mode === 'pm_only' ? 'pm_only' : 'collaborative' });
      if (mode === 'foreign-block') {
        if (method === 'createAssignment') f.db.employees[0].user_id = 'someone-else';
        else f.db.assignments[0].employee_id = 'e2';
      }
      await assert.rejects(new Store(f.client)[method](params));
      assert.deepEqual(writes(f), []);
    });
  }
}

test('copy creates an independent task by default and retains saved description/color/position', async () => {
  const f = fixture();
  const result = await new Store(f.client).copyAssignments(copy);
  const copied = result.assignments.find((a) => a.id !== 'a');
  assert.notEqual(copied.taskId, 'task');
  assert.equal(copied.startDate, '2026-09-15');
  assert.equal(copied.startHour, 8);
  assert.equal(copied.durationHours, 2);
  const task = result.tasks.find((task) => task.id === copied.taskId);
  assert.equal(task.title, 'Task');
  assert.equal(task.status, 'Description');
  assert.equal(task.epicId, 'ep0');
  assert.ok(f.db.assignments.some((a) => a.id === copied.id));
});

test('linked copy preserves task identity without inserting another task', async () => {
  const f = fixture();
  const result = await new Store(f.client).copyAssignments({ ...copy, linkTasks: true });
  assert.equal(result.assignments.find((a) => a.id !== 'a').taskId, 'task');
  assert.equal(f.db.tasks.length, 1);
});

for (const role of ['admin', 'pm']) {
  test(`${role} can copy to another employee in a PM-only team`, async () => {
    const f = fixture({ role, mode: 'pm_only' });
    const result = await new Store(f.client).copyAssignments({ ...copy, targetEmployeeId: 'e2' });
    assert.equal(result.assignments.find((a) => a.id !== 'a').employeeId, 'e2');
  });
}

for (const role of ['employee', 'admin', 'pm']) {
  test(`${role}: copy rejects a target outside the team`, async () => {
    const f = fixture({ role });
    await assert.rejects(new Store(f.client).copyAssignments({ ...copy, targetEmployeeId: 'foreign' }));
    assert.deepEqual(writes(f), []);
  });
}

test('same store observes revoked membership, edit mode and employee ownership on the next request', async () => {
  for (const revoke of [
    (f) => { f.db.team_members = []; },
    (f) => { f.db.teams[0].edit_mode = 'pm_only'; },
    (f) => { f.db.employees[0].user_id = 'someone-else'; }
  ]) {
    const f = fixture();
    const store = new Store(f.client);
    await store.copyAssignments(copy);
    revoke(f);
    f.calls.length = 0;
    await assert.rejects(store.copyAssignments(copy));
    assert.deepEqual(writes(f), []);
  }
});

test('membership query failure prevents saving', async () => {
  const f = fixture();
  f.faults.add('team_members');
  await assert.rejects(new Store(f.client).copyAssignments(copy), /Read failed/);
  assert.deepEqual(writes(f), []);
});

test('demoted admin cannot edit other employees even when the original invite still grants admin', async () => {
  const f = fixture({ role: 'admin' });
  const store = new Store(f.client);
  await store.copyAssignments({ ...copy, targetEmployeeId: 'e2' });
  f.db.team_members[0].role = 'employee';
  f.calls.length = 0;
  await assert.rejects(store.copyAssignments({ ...copy, targetEmployeeId: 'e2' }));
  assert.equal(f.db.team_members[0].role, 'employee');
  assert.deepEqual(writes(f), []);
});

test('bulk move validates the same destination once even for many selected blocks', async () => {
  const f = fixture({ role: 'admin' });
  f.db.assignments = Array.from({ length: 20 }, (_, i) => ({ ...f.db.assignments[0], id: `a${i}` }));
  const result = await new Store(f.client).bulkMoveAssignments({ ...base, moves: f.db.assignments.map((a) => ({ assignmentId: a.id, employeeId: 'e1', date: '2026-09-15', startHour: 8 })) });
  assert.equal(result.assignments.length, 20);
  assert.equal(f.calls.filter((call) => call.table === 'employees').length, 2); // destination check + snapshot
});

test('initial team loading still provisions invited members', async () => {
  const f = fixture();
  f.db.app_users = [];
  f.db.team_members = [];
  const result = await new Store(f.client).listTeamsForUser('user-1');
  assert.equal(result[0].id, 't');
  assert.ok(f.db.app_users.some((user) => user.id === 'user-1'));
  assert.ok(f.db.team_members.some((member) => member.user_id === 'user-1'));
});
