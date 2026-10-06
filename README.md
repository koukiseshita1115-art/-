# 🏋️ 筋トレ記録（Claude 連携対応）

筋トレを記録する Web アプリと、記録を **Claude と同期する MCP サーバー** のセットです。

- **Web アプリ**で種目・重量・回数・セットを記録し、履歴・自己ベスト（推定 1RM）・集計を見られます。
- **MCP サーバー**を Claude Desktop / Claude Code に登録すると、Claude に
  「今日ベンチ 80kg×8 を 3 セットやった」と話すだけで**自動で記録**されます。
- Web アプリと Claude は**同じデータファイル**を読み書きするので、どちらで記録してもすぐ両方に反映されます。
  Claude は過去の記録を読んで、振り返りや次回メニューの提案もできます。

```
 ┌──────────────┐      ┌───────────────────┐      ┌──────────────┐
 │ Web アプリ    │ ───▶ │ data/workouts.json │ ◀─── │ MCP サーバー  │ ◀── Claude
 │ (src/server) │ ◀─── │   （共有データ）    │ ───▶ │ (src/mcp)    │
 └──────────────┘      └───────────────────┘      └──────────────┘
```

## セットアップ

Node.js 18 以上が必要です。

```bash
npm install
npm start          # → http://127.0.0.1:3000
```

スマホから使う場合は `HOST=0.0.0.0 npm start` で起動し、同じ Wi-Fi から `http://<PCのIP>:3000` を開いてください
（認証はないので信頼できるネットワークでのみ使ってください）。

## Claude との同期設定

### Claude Code

このリポジトリには `.mcp.json` が含まれているので、リポジトリのディレクトリで `claude` を起動すると
`workout-log` サーバーの有効化を確認されます。承認すればそのまま使えます。

他のディレクトリからも使いたい場合は、ユーザースコープで登録します:

```bash
claude mcp add workout-log --scope user -- node /絶対パス/src/mcp.js
```

### Claude Desktop

設定 → 開発者 → 設定を編集 で `claude_desktop_config.json` を開き、次を追加して Claude Desktop を再起動します。

```json
{
  "mcpServers": {
    "workout-log": {
      "command": "node",
      "args": ["/絶対パス/src/mcp.js"]
    }
  }
}
```

### 使い方の例

- 「今日は胸の日。ベンチ 80kg×8, 8, 7、ダンベルフライ 14kg×12 を 3 セット」→ 自動で記録
- 「昨日のスクワット、実は 105kg だった。直しておいて」→ 記録を修正
- 「直近 1 か月の振り返りをして、来週のメニューを考えて」→ 記録を読んで提案
- 「ベンチの自己ベストは？」→ 最大重量と推定 1RM を回答

### MCP ツール一覧

| ツール | 内容 |
| --- | --- |
| `log_workout` | トレーニングを記録（日付省略で今日） |
| `list_workouts` | 記録の一覧（期間・種目で絞り込み） |
| `get_summary` | 直近 N 日の頻度・セット数・ボリューム集計 |
| `get_personal_records` | 種目ごとの最大重量・推定 1RM |
| `list_exercises` | 記録済みの種目名一覧（表記ゆれ防止用） |
| `update_workout` | 記録の修正 |
| `delete_workout` | 記録の削除 |

### MCP を使わない場合

Web アプリの「Claude 連携」タブで **Claude 用にコピー** を押すと、記録が Markdown 形式でコピーされます。
claude.ai やスマホの Claude アプリのチャットにそのまま貼り付けて相談できます。


## 外出先でも使えるスマホ版（claude.ai Artifact）

`artifact/index.html` は claude.ai 上で動くスマホ向け版です。インストール不要で、Claude にログインしていればどこからでも開けます。

- 記録は claude.ai 上に保存され、どの端末から開いても同じ記録が見られます。
- 「ベンチ 80kg を 8 回 3 セット」のように文章で書くと、Claude がフォームに変換します。
- 「Claude」タブで、記録をもとに振り返りや次回メニューを相談できます。
- Claude Code からは `ArtifactData` ツールで記録を読み書きできます（コレクション `workouts`）。

このスマホ版の記録は、PC 版（`data/workouts.json`）とは別に保存されます。

## データ

- 既定の保存先: `data/workouts.json`（Git 管理外）
- 環境変数 `WORKOUT_LOG_FILE` で変更できます。Web アプリと MCP サーバーで**同じ値**にしてください。
  Claude Desktop の場合は設定の `"env": { "WORKOUT_LOG_FILE": "..." }` で指定できます。

## REST API

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/workouts?from=&to=&exercise=&limit=` | 一覧（新しい順） |
| POST | `/api/workouts` | 追加 |
| PUT | `/api/workouts/:id` | 修正 |
| DELETE | `/api/workouts/:id` | 削除 |
| GET | `/api/records` | 自己ベスト |
| GET | `/api/summary?days=30` | 集計 |
| GET | `/api/exercises` | 種目名一覧 |
| GET | `/api/export.md?days=30` | Markdown エクスポート |

記録の形式:

```json
{
  "date": "2026-10-06",
  "title": "胸の日",
  "notes": "調子良し",
  "exercises": [
    { "name": "ベンチプレス", "sets": [{ "weight": 80, "reps": 8 }, { "weight": 80, "reps": 7 }] }
  ]
}
```

## テスト

```bash
npm test
```
