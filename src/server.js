#!/usr/bin/env node
// Web UI と REST API を提供する HTTP サーバー（依存なし）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkoutStore, formatWorkouts } from './store.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function send(res, status, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(payload);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('リクエストが大きすぎます');
  }
  return body ? JSON.parse(body) : {};
}

export function createServer(store = new WorkoutStore()) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    try {
      if (p === '/api/workouts' && req.method === 'GET') {
        const q = Object.fromEntries(url.searchParams);
        return send(res, 200, store.list({ ...q, limit: q.limit ? Number(q.limit) : undefined }));
      }
      if (p === '/api/workouts' && req.method === 'POST') {
        return send(res, 201, store.add(await readJson(req), 'web'));
      }
      const m = p.match(/^\/api\/workouts\/([\w-]+)$/);
      if (m && req.method === 'PUT') {
        const w = store.update(m[1], await readJson(req));
        return w ? send(res, 200, w) : send(res, 404, { error: '見つかりません' });
      }
      if (m && req.method === 'DELETE') {
        return store.remove(m[1]) ? send(res, 204, '') : send(res, 404, { error: '見つかりません' });
      }
      if (p === '/api/exercises') return send(res, 200, store.exerciseNames());
      if (p === '/api/records') return send(res, 200, store.personalRecords());
      if (p === '/api/summary') return send(res, 200, store.summary({ days: Number(url.searchParams.get('days')) || 30 }));
      if (p === '/api/export.md') {
        const days = Number(url.searchParams.get('days')) || 30;
        const { from } = store.summary({ days });
        return send(res, 200, formatWorkouts(store.list({ from })), 'text/markdown');
      }
      if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

      // 静的ファイル
      const file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p);
      if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        return send(res, 404, 'Not found', 'text/plain');
      }
      return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const store = new WorkoutStore();
  createServer(store).listen(port, host, () => {
    console.log(`筋トレ記録アプリ: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`データファイル: ${store.file}`);
  });
}
