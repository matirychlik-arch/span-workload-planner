const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
function loadModule(entry, storeSource) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const source = file === 'lib/data/supabase-store.ts' && storeSource
      ? storeSource : fs.readFileSync(path.join(root, file), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    });
    const module = { exports: {} };
    const requireTest = (id) => {
      if (id === '@/lib/supabase/admin') return {
        createSupabaseAdminClient() { throw new Error('Tests must not access a real database'); }
      };
      if (id.startsWith('@/')) return load(`${id.slice(2)}.ts`);
      if (id.startsWith('node:')) return require(id);
      throw new Error(`Unexpected test dependency: ${id}`);
    };
    new Function('require', 'module', 'exports', outputText)(requireTest, module, module.exports);
    cache.set(file, module.exports);
    return module.exports;
  }
  return load(entry);
}
function loadStore(storeSource) { return loadModule('lib/data/supabase-store.ts', storeSource).SupabaseStore; }

function fixture({ role = 'employee', mode = 'collaborative', delayMs = 0 } = {}) {
  const calls = [];
  const db = {
    assignment_recurrences: [],
    workspaces: [{ id: 'w', name: 'Test', google_auth_enabled: true, jira_connected: false, slack_connected: false }],
    app_users: [{ id: 'user-1', workspace_id: 'w', email: 'test@example.test', name: 'Test' }],
    teams: [{ id: 't', workspace_id: 'w', name: 'Test', pm_user_id: 'pm', edit_mode: mode }],
    team_members: role ? [{ team_id: 't', user_id: 'user-1', role }] : [],
    employees: [
      { id: 'e1', workspace_id: 'w', team_id: 't', user_id: 'user-1', name: 'Test employee', active: true },
      { id: 'e2', workspace_id: 'w', team_id: 't', user_id: 'user-2', name: 'Other employee', active: true },
      { id: 'foreign', workspace_id: 'w2', team_id: 't2', user_id: 'user-3', name: 'Foreign', active: true }
    ],
    epics: Array.from({ length: 12 }, (_, i) => ({ id: `ep${i}`, workspace_id: 'w', team_id: 't', name: `Kolor ${i + 1}`, color: '#45A676' })),
    tasks: [{ id: 'task', workspace_id: 'w', team_id: 't', source: 'manual', title: 'Task', status: 'Description', epic_id: 'ep0' }],
    assignments: [{ id: 'a', workspace_id: 'w', team_id: 't', task_id: 'task', employee_id: 'e1', start_date: '2026-09-14', start_hour: 8, desired_start_hour: 8, duration_hours: 2, duration_days: 1, version: 1, updated_at: '2026-09-14T06:00:00Z' }],
    workspace_invites: [{ id: 'invite', workspace_id: 'w', team_id: 't', email: 'test@example.test', name: 'Test', role: role ?? 'employee', employee_name: 'Test employee', active: true }]
  };
  const faults = new Set();
  async function record(table, action, details = {}) {
    calls.push({ table, action, ...details });
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const client = {
    auth: { admin: { async getUserById(id) {
      await record('auth', 'getUserById');
      return { data: { user: { id, email: 'test@example.test', user_metadata: { name: 'Test' } } }, error: null };
    } } },
    from(table) {
      if (!db[table]) throw new Error(`Unexpected table: ${table}`);
      let action = 'select', payload, keys = ['id'], single = false, max = Infinity, offset = 0;
      const filters = [];
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        neq(key, value) { filters.push((row) => row[key] !== value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        ilike(key, value) { filters.push((row) => String(row[key]).toLowerCase() === value.toLowerCase()); return query; },
        order() { return query; },
        limit(value) { max = value; return query; },
        range(from, to) { offset = from; max = to + 1; return query; },
        maybeSingle() { single = true; return query; },
        single() { single = true; return query; },
        insert(value) { action = 'insert'; payload = value; return query; },
        update(value) { action = 'update'; payload = value; return query; },
        upsert(value, options) { action = 'upsert'; payload = value; keys = (options?.onConflict ?? 'id').split(','); return query; },
        delete() { action = 'delete'; return query; },
        then(resolve, reject) {
          return (async () => {
            await record(table, action, { payload: structuredClone(payload) });
            if (faults.has(table)) return { data: null, error: { message: `Read failed: ${table}` } };
            const matches = (row) => filters.every((filter) => filter(row));
            if (action === 'insert' || action === 'upsert') {
              for (const row of Array.isArray(payload) ? payload : [payload]) {
                const index = action === 'upsert' ? db[table].findIndex((old) => keys.every((key) => old[key] === row[key])) : -1;
                if (index < 0) db[table].push(structuredClone(row));
                else db[table][index] = { ...db[table][index], ...structuredClone(row) };
              }
            } else if (action === 'update') {
              db[table].forEach((row) => { if (matches(row)) Object.assign(row, structuredClone(payload)); });
            } else if (action === 'delete') db[table] = db[table].filter((row) => !matches(row));
            const rows = db[table].filter(matches).slice(offset, max);
            return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
          })().then(resolve, reject);
        }
      };
      return query;
    }
  };
  return { client, calls, db, faults };
}

module.exports = { loadStore, loadModule, fixture };
