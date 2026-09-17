# beachball-portal — ビーチボール大会申し込みサイト【仮】

ビーチボール大会の申込・チーム管理・大会資料の掲示・協会員の年度更新を行うサイト。最初の協会は早良区協会。サイト名は仮で、`src/lib/site.ts` の `SITE_NAME` だけに書く（L-03 で作る）。

## 開発環境

[docs/setup.md](docs/setup.md) を見る（Dev Container に統一。Node.js 24・pnpm・Postgres 16・Mailpit・Playwright・Claude Code はコンテナの中）。

## 起動のしかた

L-03（Next.js の雛形）・L-04（DB の土台）のあとに書く。

## 進め方

- タスクは `p0-tasks.md`（設計書と同じ場所にある）を 1 つずつ。エージェント向けの決まりは [CLAUDE.md](CLAUDE.md)
- 進み具合と申し送り: [docs/progress.md](docs/progress.md)
- 設計書: [docs/design/](docs/design/)（節ごと。一覧は [docs/design/index.md](docs/design/index.md)。元は `docs/design.md` v0.9.5）
- 決定の記録: [docs/adr/](docs/adr/)
- 運用手順: `docs/ops.md`（A-29 で作る）
- プライバシーポリシー・利用規約: [docs/legal/](docs/legal/)

## 構成（予定）

| 場所 | 中身 |
|---|---|
| `src/app/` | Next.js（App Router）の画面と API |
| `src/db/` | Drizzle の schema・マイグレーション・`withTenant` |
| `src/lib/` | 正規化・名寄せ・日付・年齢・締切・部門・会員・認可・メール |
| `tools/` | 開発の補助スクリプト |
| `.devcontainer/` | 開発環境の定義 |
