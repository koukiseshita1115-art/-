#!/usr/bin/env node
// Claude 連携用 MCP サーバー（stdio）。
// Claude Desktop / Claude Code に登録すると、会話の中で
// 「今日ベンチ 80kg×8 を 3 セットやった」と言うだけで Claude が記録し、
// 過去の記録を読んでアドバイスできるようになる。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WorkoutStore, formatWorkout, formatWorkouts, today } from './store.js';

const store = new WorkoutStore();

const setSchema = z.object({
  weight: z.number().min(0).describe('重量 (kg)。自重種目は 0'),
  reps: z.number().int().positive().describe('回数'),
});
const exerciseSchema = z.object({
  name: z.string().min(1).describe('種目名（例: ベンチプレス, スクワット）'),
  sets: z.array(setSchema).min(1).describe('セットの一覧。3 セット同じなら 3 要素並べる'),
});
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

function safe(fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(`エラー: ${err.message}`);
    }
  };
}

const server = new McpServer({ name: 'workout-log', version: '1.0.0' });

server.registerTool(
  'log_workout',
  {
    title: '筋トレを記録',
    description:
      'ユーザーが行った筋トレを記録する。ユーザーがトレーニング内容を話したら、確認なしでこのツールで記録してよい。' +
      `日付を省略すると今日 (${today()}) になる。既存種目名と表記を揃えるため、迷ったら先に list_exercises を呼ぶこと。`,
    inputSchema: {
      date: dateSchema.optional().describe('トレーニング日 YYYY-MM-DD'),
      title: z.string().optional().describe('例: 胸の日, Push, 脚トレ'),
      notes: z.string().optional().describe('体調や感想など'),
      exercises: z.array(exerciseSchema).min(1),
    },
  },
  safe(async (args) => {
    const w = store.add(args, 'claude');
    return text(`記録しました。\n\n${formatWorkout(w)}`);
  }),
);

server.registerTool(
  'list_workouts',
  {
    title: '記録を一覧',
    description: '過去の筋トレ記録を新しい順に取得する。期間や種目で絞り込める。',
    inputSchema: {
      from: dateSchema.optional().describe('開始日 YYYY-MM-DD'),
      to: dateSchema.optional().describe('終了日 YYYY-MM-DD'),
      exercise: z.string().optional().describe('種目名（部分一致）'),
      limit: z.number().int().positive().max(200).optional().describe('最大件数（既定 20）'),
    },
    annotations: { readOnlyHint: true },
  },
  safe(async ({ limit = 20, ...filter }) => text(formatWorkouts(store.list({ ...filter, limit })))),
);

server.registerTool(
  'get_summary',
  {
    title: 'トレーニング集計',
    description: '直近 N 日間の頻度・セット数・総ボリューム・種目別内訳を返す。',
    inputSchema: { days: z.number().int().positive().max(365).optional().describe('既定 30') },
    annotations: { readOnlyHint: true },
  },
  safe(async ({ days = 30 }) => text(JSON.stringify(store.summary({ days }), null, 2))),
);

server.registerTool(
  'get_personal_records',
  {
    title: '自己ベスト',
    description: '種目ごとの最大重量と推定 1RM（Epley 式）を返す。',
    inputSchema: { exercise: z.string().optional().describe('種目名（完全一致）。省略で全種目') },
    annotations: { readOnlyHint: true },
  },
  safe(async ({ exercise }) => text(JSON.stringify(store.personalRecords(exercise), null, 2))),
);

server.registerTool(
  'list_exercises',
  {
    title: '種目一覧',
    description: 'これまでに記録された種目名を頻度順で返す。',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  safe(async () => {
    const names = store.exerciseNames();
    return text(names.length ? names.join('\n') : 'まだ種目はありません。');
  }),
);

server.registerTool(
  'update_workout',
  {
    title: '記録を修正',
    description: 'id を指定して記録を修正する。指定したフィールドだけ置き換わる（exercises は丸ごと置換）。',
    inputSchema: {
      id: z.string(),
      date: dateSchema.optional(),
      title: z.string().optional(),
      notes: z.string().optional(),
      exercises: z.array(exerciseSchema).min(1).optional(),
    },
  },
  safe(async ({ id, ...patch }) => {
    const w = store.update(id, patch);
    return w ? text(`修正しました。\n\n${formatWorkout(w)}`) : fail(`id ${id} の記録が見つかりません`);
  }),
);

server.registerTool(
  'delete_workout',
  {
    title: '記録を削除',
    description: 'id を指定して記録を削除する。',
    inputSchema: { id: z.string() },
    annotations: { destructiveHint: true },
  },
  safe(async ({ id }) =>
    store.remove(id) ? text('削除しました。') : fail(`id ${id} の記録が見つかりません`)),
);

await server.connect(new StdioServerTransport());
