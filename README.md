# beachball-portal — ビーチボール大会申し込みサイト【仮】

ビーチボール大会の申込・チーム管理・大会資料の掲示・協会員の年度更新を行うサイト。最初の協会は早良区協会。サイト名は仮で、`src/lib/site.ts` の `SITE_NAME` だけに書く。

## 開発環境

[docs/setup.md](docs/setup.md) を見る（Dev Container に統一。Node.js 24・pnpm・Postgres 16・Mailpit・Playwright・Claude Code はコンテナの中。Windows は §7）。

## 起動のしかた

1. コンテナを開く（[docs/setup.md](docs/setup.md)）
2. コンテナの中で `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000
3. テスト: `pnpm lint` / `pnpm typecheck` / `pnpm test`（Vitest。`TZ=UTC` と `TZ=Asia/Tokyo` の 2 回）/ `pnpm test:e2e`（Playwright。WebKit 375×667 と Chromium 360×640）。E2E のレポートは `pnpm exec playwright show-report --host 0.0.0.0` → http://localhost:9323

DB の準備（`pnpm db:roles` → `pnpm db:migrate`）は L-04 で足す。

## 進め方

- タスクは `p0-tasks.md`（設計書と同じ場所にある）を 1 つずつ。エージェント向けの決まりは [CLAUDE.md](CLAUDE.md)
- 進み具合と申し送り: [docs/progress.md](docs/progress.md)
- 設計書: [docs/design/](docs/design/)（節ごと。一覧は [docs/design/index.md](docs/design/index.md)。元は `docs/design.md` v0.9.5）
- 決定の記録: [docs/adr/](docs/adr/)
- 運用手順: `docs/ops.md`（A-29 で作る）
- プライバシーポリシー・利用規約: [docs/legal/](docs/legal/)

## 構成

| 場所 | 中身 |
|---|---|
| `src/app/` | Next.js（App Router）の画面と API。`globals.css`・`tokens.css`（色と動きの CSS 変数） |
| `src/lib/` | 正規化・名寄せ・日付・年齢・締切・部門・会員・認可・メール。`site.ts`（サイト名） |
| `src/db/` | Drizzle の schema・マイグレーション・`withTenant`（L-04 から） |
| `tests/unit/`・`tests/e2e/` | Vitest・Playwright |
| `tools/` | 開発の補助スクリプト |
| `.devcontainer/` | 開発環境の定義 |
