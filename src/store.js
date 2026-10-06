// 筋トレ記録のデータストア。
// Web UI と MCP サーバー（Claude 連携）は同じ JSON ファイルを読み書きするため、
// どちらで記録してももう一方にすぐ反映される。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function defaultDataFile() {
  return process.env.WORKOUT_LOG_FILE || path.join(ROOT, 'data', 'workouts.json');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Epley 式による推定 1RM
export function estimate1RM(weight, reps) {
  if (!weight || !reps) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

function normalizeName(name) {
  return String(name).trim().replace(/\s+/g, ' ');
}

export function validateWorkout(input) {
  if (!input || typeof input !== 'object') throw new Error('記録データが不正です');
  const date = input.date ?? today();
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error(`日付は YYYY-MM-DD 形式で指定してください: ${date}`);
  }
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    throw new Error('種目を 1 つ以上指定してください');
  }
  const exercises = input.exercises.map((ex, i) => {
    const name = normalizeName(ex?.name ?? '');
    if (!name) throw new Error(`${i + 1} 番目の種目名が空です`);
    if (!Array.isArray(ex.sets) || ex.sets.length === 0) {
      throw new Error(`「${name}」のセットを 1 つ以上指定してください`);
    }
    const sets = ex.sets.map((s, j) => {
      const weight = Number(s?.weight ?? 0);
      const reps = Number(s?.reps);
      if (!Number.isFinite(weight) || weight < 0) {
        throw new Error(`「${name}」${j + 1} セット目の重量が不正です`);
      }
      if (!Number.isInteger(reps) || reps <= 0) {
        throw new Error(`「${name}」${j + 1} セット目の回数が不正です`);
      }
      return { weight, reps };
    });
    return { name, sets };
  });
  return {
    date,
    title: input.title ? String(input.title).trim() : '',
    notes: input.notes ? String(input.notes).trim() : '',
    exercises,
  };
}

export function workoutVolume(workout) {
  return workout.exercises.reduce(
    (sum, ex) => sum + ex.sets.reduce((s, set) => s + set.weight * set.reps, 0),
    0,
  );
}

export class WorkoutStore {
  constructor(file = defaultDataFile()) {
    this.file = file;
  }

  // 他プロセスの書き込みを拾うため、毎回ファイルから読み込む
  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(data.workouts) ? data.workouts : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  save(workouts) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, workouts }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  add(input, source = 'web') {
    const workout = {
      id: crypto.randomUUID(),
      ...validateWorkout(input),
      source,
      createdAt: new Date().toISOString(),
    };
    const workouts = this.load();
    workouts.push(workout);
    this.save(workouts);
    return workout;
  }

  update(id, input) {
    const workouts = this.load();
    const idx = workouts.findIndex((w) => w.id === id);
    if (idx === -1) return null;
    workouts[idx] = {
      ...workouts[idx],
      ...validateWorkout({ ...workouts[idx], ...input }),
      updatedAt: new Date().toISOString(),
    };
    this.save(workouts);
    return workouts[idx];
  }

  remove(id) {
    const workouts = this.load();
    const next = workouts.filter((w) => w.id !== id);
    if (next.length === workouts.length) return false;
    this.save(next);
    return true;
  }

  get(id) {
    return this.load().find((w) => w.id === id) ?? null;
  }

  // 新しい順に返す
  list({ from, to, exercise, limit } = {}) {
    const needle = exercise ? exercise.toLowerCase() : null;
    let result = this.load()
      .filter((w) => (!from || w.date >= from) && (!to || w.date <= to))
      .filter((w) => !needle || w.exercises.some((e) => e.name.toLowerCase().includes(needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    if (limit) result = result.slice(0, limit);
    return result;
  }

  exerciseNames() {
    const counts = new Map();
    for (const w of this.load()) {
      for (const e of w.exercises) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  // 種目ごとの自己ベスト（最大重量・推定 1RM）
  personalRecords(exercise) {
    const records = new Map();
    for (const w of this.load()) {
      for (const e of w.exercises) {
        if (exercise && e.name.toLowerCase() !== exercise.toLowerCase()) continue;
        const rec = records.get(e.name) ?? {
          exercise: e.name,
          maxWeight: null,
          best1RM: null,
          sessions: 0,
        };
        rec.sessions += 1;
        for (const s of e.sets) {
          if (!rec.maxWeight || s.weight > rec.maxWeight.weight ||
            (s.weight === rec.maxWeight.weight && s.reps > rec.maxWeight.reps)) {
            rec.maxWeight = { weight: s.weight, reps: s.reps, date: w.date };
          }
          const e1rm = estimate1RM(s.weight, s.reps);
          if (!rec.best1RM || e1rm > rec.best1RM.value) {
            rec.best1RM = { value: e1rm, weight: s.weight, reps: s.reps, date: w.date };
          }
        }
        records.set(e.name, rec);
      }
    }
    return [...records.values()].sort((a, b) => b.sessions - a.sessions);
  }

  summary({ days = 30 } = {}) {
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));
    const from = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
    const workouts = this.list({ from });
    const perExercise = new Map();
    let totalSets = 0;
    for (const w of workouts) {
      for (const e of w.exercises) {
        const p = perExercise.get(e.name) ?? { exercise: e.name, sessions: 0, sets: 0, volume: 0 };
        p.sessions += 1;
        p.sets += e.sets.length;
        p.volume += e.sets.reduce((s, set) => s + set.weight * set.reps, 0);
        perExercise.set(e.name, p);
        totalSets += e.sets.length;
      }
    }
    return {
      days,
      from,
      to: today(),
      workoutCount: workouts.length,
      trainingDays: new Set(workouts.map((w) => w.date)).size,
      totalSets,
      totalVolume: workouts.reduce((s, w) => s + workoutVolume(w), 0),
      exercises: [...perExercise.values()].sort((a, b) => b.volume - a.volume),
      lastWorkoutDate: workouts[0]?.date ?? null,
    };
  }
}

// Claude に貼り付けたり、MCP の応答に使う Markdown 表現
export function formatWorkout(w) {
  const head = `### ${w.date}${w.title ? ` ${w.title}` : ''}`;
  const lines = w.exercises.map((e) => {
    const sets = e.sets.map((s) => `${s.weight}kg×${s.reps}`).join(', ');
    return `- ${e.name}: ${sets}`;
  });
  if (w.notes) lines.push(`- メモ: ${w.notes}`);
  lines.push(`- 総ボリューム: ${workoutVolume(w)}kg (id: ${w.id})`);
  return [head, ...lines].join('\n');
}

export function formatWorkouts(workouts) {
  if (workouts.length === 0) return '記録はまだありません。';
  return workouts.map(formatWorkout).join('\n\n');
}
