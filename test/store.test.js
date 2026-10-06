import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkoutStore, estimate1RM, formatWorkout } from '../src/store.js';

const tmpStore = () =>
  new WorkoutStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-')), 'w.json'));

const bench = { name: 'ベンチプレス', sets: [{ weight: 80, reps: 8 }, { weight: 85, reps: 5 }] };

test('add / list / remove', () => {
  const s = tmpStore();
  const a = s.add({ date: '2026-10-01', exercises: [bench] });
  s.add({ date: '2026-10-03', exercises: [{ name: 'スクワット', sets: [{ weight: 100, reps: 5 }] }] }, 'claude');
  assert.deepEqual(s.list().map((w) => w.date), ['2026-10-03', '2026-10-01']);
  assert.equal(s.list({ exercise: 'ベンチ' }).length, 1);
  assert.equal(s.list({ from: '2026-10-02' }).length, 1);
  assert.equal(s.list()[0].source, 'claude');
  assert.ok(s.remove(a.id));
  assert.equal(s.list().length, 1);
  assert.equal(s.remove('nope'), false);
});

test('validation', () => {
  const s = tmpStore();
  assert.throws(() => s.add({ exercises: [] }), /種目/);
  assert.throws(() => s.add({ date: '2026/10/01', exercises: [bench] }), /日付/);
  assert.throws(() => s.add({ exercises: [{ name: 'x', sets: [{ weight: 10, reps: 0 }] }] }), /回数/);
  assert.equal(s.add({ exercises: [{ name: '懸垂', sets: [{ reps: 10 }] }] }).exercises[0].sets[0].weight, 0);
});

test('update keeps unspecified fields', () => {
  const s = tmpStore();
  const w = s.add({ date: '2026-10-01', title: '胸', exercises: [bench] });
  const u = s.update(w.id, { notes: '調子良い' });
  assert.equal(u.title, '胸');
  assert.equal(u.notes, '調子良い');
  assert.equal(u.exercises.length, 1);
  assert.equal(s.update('nope', {}), null);
});

test('personal records and 1RM', () => {
  const s = tmpStore();
  s.add({ date: '2026-10-01', exercises: [bench] });
  s.add({ date: '2026-10-05', exercises: [{ name: 'ベンチプレス', sets: [{ weight: 70, reps: 15 }] }] });
  const [r] = s.personalRecords('ベンチプレス');
  assert.equal(r.sessions, 2);
  assert.deepEqual(r.maxWeight, { weight: 85, reps: 5, date: '2026-10-01' });
  assert.equal(r.best1RM.value, estimate1RM(70, 15));
  assert.equal(estimate1RM(100, 1), 100);
});

test('summary and markdown', () => {
  const s = tmpStore();
  const w = s.add({ exercises: [bench] });
  const sum = s.summary({ days: 7 });
  assert.equal(sum.workoutCount, 1);
  assert.equal(sum.totalSets, 2);
  assert.equal(sum.totalVolume, 80 * 8 + 85 * 5);
  assert.match(formatWorkout(w), /ベンチプレス: 80kg×8, 85kg×5/);
});
