# beachball-portal — ビーチボール大会申し込みサイト【仮】

ビーチボール大会の申込・チーム管理・大会資料の掲示・協会員の年度更新を行うサイト。最初の協会は早良区協会。サイト名は仮で、`src/lib/site.ts` の `SITE_NAME` だけに書く。

## 開発環境

[docs/setup.md](docs/setup.md) を見る（Dev Container に統一。Node.js 24・pnpm・Postgres 16・Mailpit・Playwright・Claude Code はコンテナの中。Windows は §7）。

## 起動のしかた

1. コンテナを開く（[docs/setup.md](docs/setup.md)）。Postgres（コンテナの中から `db:5432`）と Mailpit（受信箱は http://localhost:8025 ）も一緒に起動する。`.env` は初回に `.env.example` から作られる
2. コンテナの中で `pnpm db:roles`（DB のロールを作る。何度流してもよい）→ `pnpm db:migrate`（テーブルと拡張を作る）。初回と、マイグレーションが増えたとき
3. `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 。http://localhost:3000/api/health が `{"ok":true}` なら DB につながっている
4. テスト: `pnpm lint` / `pnpm typecheck` / `pnpm test`（Vitest。`TZ=UTC` と `TZ=Asia/Tokyo` の 2 回。`tests/db/` は Postgres が要る）/ `pnpm test:e2e`（Playwright。WebKit 375×667 と Chromium 360×640）。E2E のレポートは `pnpm exec playwright show-report --host 0.0.0.0` → http://localhost:9323

CI: GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）が pull request と main への push で lint → typecheck → test を流す（Postgres はサービスコンテナ。デプロイは入れない）。

DB のほかのコマンド: `pnpm db:generate`（`src/db/schema.ts` からマイグレーションを作る）/ `pnpm db:studio`（→ http://localhost:4983 ）/ `pnpm db:reset`（ローカルだけ。DB を消して作り直す）。

## 進め方

- タスクは [docs/p0-tasks.md](docs/p0-tasks.md) を 1 つずつ。エージェント向けの決まりは [CLAUDE.md](CLAUDE.md)（元は [docs/agent_prompt.md](docs/agent_prompt.md) の F。A〜D の受け入れ条件・E のステップ用プロンプトもここ）
- 進み具合と申し送り: [docs/progress.md](docs/progress.md)
- 設計書: [docs/design/](docs/design/)（節ごと。一覧は [docs/design/index.md](docs/design/index.md)。元は `docs/design.md` v0.9.5）
- 決定の記録: [docs/adr/](docs/adr/)
- 設計書ができるまでの記録: [docs/history/](docs/history/)（`decisions-v0.9*.md`・`review-v0.8.md`。タスクでは読まない）
- 運用手順: `docs/ops.md`（A-29 で作る）
- プライバシーポリシー・利用規約: [docs/legal/](docs/legal/)

## 構成

| 場所 | 中身 |
|---|---|
| `src/app/` | Next.js（App Router）の画面と API。`globals.css`・`tokens.css`（色と動きの CSS 変数） |
| `src/lib/` | 正規化・名寄せ・日付・年齢・締切・部門・会員・認可・メール。`site.ts`（サイト名） |
| `src/db/` | Drizzle の `schema.ts`・`migrations/`・接続プール（`client.ts`）・`withTenant`（`tenant.ts`）・DB のスクリプト（`scripts/`） |
| `tests/unit/`・`tests/e2e/` | Vitest・Playwright |
| `tools/` | 開発の補助スクリプト |
| `.devcontainer/` | 開発環境の定義 |
