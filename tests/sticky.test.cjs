const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const ts = require('typescript');

// Load the pure domain modules with the existing TypeScript dependency.
const root = path.resolve(__dirname, '..');
const modules = new Map();
function loadDomain(relativePath) {
  if (modules.has(relativePath)) return modules.get(relativePath);
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const module = { exports: {} };
  const requireDomain = (id) => {
    assert.ok(id.startsWith('@/lib/domain/'), `Unexpected domain dependency: ${id}`);
    return loadDomain(`${id.slice(2)}.ts`);
  };
  new Function('require', 'module', 'exports', outputText)(requireDomain, module, module.exports);
  modules.set(relativePath, module.exports);
  return module.exports;
}

const { resolveStickyForEmployee, resolveStickyForEmployees } = loadDomain('lib/domain/sticky.ts');
function block(id, overrides = {}) {
  return {
    id, taskId: id, workspaceId: 'workspace', teamId: 'team', employeeId: 'employee',
    startDate: '2026-09-14', startHour: 8, desiredStartHour: 8,
    durationHours: 2, durationDays: 1, version: 1, updatedAt: '2026-09-14T06:00:00Z',
    ...overrides
  };
}
const byId = (items, id) => items.find((item) => item.id === id);

test('packs collisions and pulls following blocks up after shortening', () => {
  const packed = resolveStickyForEmployee([block('a'), block('b'), block('c')]);
  assert.deepEqual(packed.map((item) => item.startHour), [8, 10, 12]);
  const resized = packed.map((item) => item.id === 'a' ? { ...item, durationHours: 1 } : item);
  assert.deepEqual(resolveStickyForEmployee(resized).map((item) => item.startHour), [8, 9, 11]);
});

test('multi-day blocks check every covered day and pinning takes priority', () => {
  const result = resolveStickyForEmployee([
    block('monday', { durationHours: 2 }),
    block('tuesday', { startDate: '2026-09-15', durationHours: 4 }),
    block('span', { durationDays: 3 })
  ]);
  assert.equal(byId(result, 'span').startHour, 12);
  const pinned = resolveStickyForEmployee(result, 'span');
  assert.equal(pinned[0].id, 'span');
  assert.equal(byId(pinned, 'span').startHour, 8);
  assert.equal(byId(pinned, 'monday').startHour, 10);
  assert.equal(byId(pinned, 'tuesday').startHour, 10);
});

test('touching time and date boundaries do not collide', () => {
  const result = resolveStickyForEmployee([
    block('a', { durationDays: 2 }),
    block('b', { startHour: 10, desiredStartHour: 10 }),
    block('c', { startDate: '2026-09-16' })
  ]);
  assert.equal(byId(result, 'a').startHour, 8);
  assert.equal(byId(result, 'b').startHour, 10);
  assert.equal(byId(result, 'c').startHour, 8);
});

test('day spans remain contiguous across DST and month boundaries', () => {
  for (const [start, covered, outside] of [
    ['2026-03-28', '2026-03-30', '2026-03-31'],
    ['2026-10-24', '2026-10-26', '2026-10-27'],
    ['2026-12-31', '2027-01-02', '2027-01-03']
  ]) {
    const result = resolveStickyForEmployee([
      block('span', { startDate: start, durationDays: 3 }),
      block('inside', { startDate: covered }),
      block('outside', { startDate: outside })
    ], 'span');
    assert.equal(byId(result, 'inside').startHour, 10);
    assert.equal(byId(result, 'outside').startHour, 8);
  }
});

test('targeted packing leaves other employees and input records untouched', () => {
  const other = Object.freeze(block('other', { employeeId: 'other' }));
  const source = Object.freeze([Object.freeze(block('a')), Object.freeze(block('b')), other]);
  const result = resolveStickyForEmployees(source, ['employee'], 'b');
  assert.strictEqual(byId(result, 'other'), other);
  assert.deepEqual(result.map((item) => item.id), source.map((item) => item.id));
  assert.equal(byId(result, 'b').startHour, 8);
  assert.equal(byId(result, 'a').startHour, 10);
  assert.equal(source[0].startHour, 8);
  assert.strictEqual(resolveStickyForEmployees(source, []), source);
});

test('different employees never block one another even in a mixed group', () => {
  const result = resolveStickyForEmployee([block('a'), block('b', { employeeId: 'other' })]);
  assert.deepEqual(result.map((item) => item.startHour), [8, 8]);
});

test('normalizes duration and start hour with the existing end-of-day policy', () => {
  const result = resolveStickyForEmployee([block('a', {
    startHour: 15, desiredStartHour: 15, durationHours: 8, durationDays: 20
  })]);
  assert.equal(result[0].startHour, 15);
  assert.equal(result[0].durationHours, 1);
  assert.equal(result[0].durationDays, 10);
});

test('saturated days terminate quickly while retaining every block', () => {
  const items = Array.from({ length: 100 }, (_, i) => block(String(i).padStart(3, '0')));
  const start = performance.now();
  const result = resolveStickyForEmployee(items);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 500, `Saturated day blocked for ${elapsed.toFixed(1)}ms`);
  assert.equal(result.length, items.length);
  assert.deepEqual(result.slice(0, 4).map((item) => item.startHour), [8, 10, 12, 14]);
  assert.ok(result.slice(4).every((item) => item.startHour === 15 && item.durationHours === 1));
});
