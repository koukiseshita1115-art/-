import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorkoutStore } from '../src/store.js';

const MCP = fileURLToPath(new URL('../src/mcp.js', import.meta.url));

test('MCP tools write to the same store the web app reads', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wl-')), 'w.json');
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [MCP], env: { ...process.env, WORKOUT_LOG_FILE: file },
  }));
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'log_workout'));

    const res = await client.callTool({ name: 'log_workout', arguments: {
      date: '2026-10-06', title: '胸の日',
      exercises: [{ name: 'ベンチプレス', sets: [{ weight: 80, reps: 8 }, { weight: 80, reps: 8 }] }],
    } });
    assert.ok(!res.isError);
    assert.match(res.content[0].text, /記録しました/);

    const [w] = new WorkoutStore(file).list();
    assert.equal(w.source, 'claude');
    assert.equal(w.exercises[0].sets.length, 2);

    const list = await client.callTool({ name: 'list_workouts', arguments: {} });
    assert.match(list.content[0].text, /ベンチプレス: 80kg×8, 80kg×8/);

    const pr = await client.callTool({ name: 'get_personal_records', arguments: {} });
    assert.equal(JSON.parse(pr.content[0].text)[0].maxWeight.weight, 80);

    const del = await client.callTool({ name: 'delete_workout', arguments: { id: 'missing' } });
    assert.ok(del.isError);
  } finally {
    await client.close();
  }
});
