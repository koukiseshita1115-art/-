import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkoutStore } from '../src/store.js';
import { createServer } from '../src/server.js';

test('REST API', async () => {
  const store = new WorkoutStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-')), 'w.json'));
  const server = createServer(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/api/workouts`, {
      method: 'POST',
      body: JSON.stringify({ exercises: [{ name: 'デッドリフト', sets: [{ weight: 120, reps: 5 }] }] }),
    });
    assert.equal(created.status, 201);
    const w = await created.json();
    assert.equal(w.source, 'web');

    const bad = await fetch(`${base}/api/workouts`, { method: 'POST', body: '{"exercises":[]}' });
    assert.equal(bad.status, 400);

    assert.equal((await (await fetch(`${base}/api/workouts`)).json()).length, 1);
    assert.deepEqual(await (await fetch(`${base}/api/exercises`)).json(), ['デッドリフト']);
    assert.match(await (await fetch(`${base}/api/export.md`)).text(), /デッドリフト: 120kg×5/);
    assert.match(await (await fetch(`${base}/`)).text(), /筋トレ記録/);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);

    assert.equal((await fetch(`${base}/api/workouts/${w.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(`${base}/api/workouts/${w.id}`, { method: 'DELETE' })).status, 404);
  } finally {
    server.close();
  }
});
