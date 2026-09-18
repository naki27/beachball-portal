# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: L-04 ローカルの Postgres・Mailpit と DB の土台（人の確認待ち。OK が出てから次へ）
- 次のタスク: L-05 CI（任意。飛ばすなら A-01 基盤のテーブル）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### L-04（2026-09-18）
- やったこと: drizzle-orm 0.45・pg 8.23（本体）、drizzle-kit 0.31・@types/pg・tsx（開発）。`.env.example`（§6.3 のローカル分。ロールのパスワードは各 `*_DATABASE_URL` に持たせ、`POSTGRES_ADMIN_URL` を追加）と `src/db/env.ts`（Node 24 の `process.loadEnvFile`。dotenv は入れない）。scripts: `db:roles`（5 ロール＋DB への接続・public スキーマの権限。何度でも）/ `db:reset`（ローカルだけ。drop → roles → migrate）/ `db:generate` / `db:migrate` / `db:studio`。`drizzle.config.ts`（app_owner・出力 `src/db/migrations/`）、`0000_extensions.sql`（pg_trgm・citext）。`src/db/client.ts`（Pool は globalThis に 1 つ。`DB_POOL_MAX`、既定 5）、`src/db/tenant.ts` の `withTenant(associationId, tx => …, { userId? })`（transaction の冒頭で `set_config(…, true)` = SET LOCAL）。`GET /api/health`。テスト `tests/db/with-tenant.test.ts`（プール 1 接続で、外に漏れないことも確認）
- 動作確認: `db:roles`・`db:migrate` を 2 回ずつ、`db:reset`（拒否 2 条件と本体）、lint / typecheck / test（TZ 2 回・7 本）が通る。Windows から http://localhost:3000/api/health → `{"ok":true}`、http://localhost:8025 が開く。E2E は画面を変えていないので流していない
- 次への申し送り・既知の課題:
  - `current_setting('app.association_id', true)` は一度も設定していなければ NULL だが、SET LOCAL したトランザクションが終わったあとは `''` になる。A-03 の RLS ポリシーは `nullif(current_setting(…, true), '')::uuid` の形にする（`''::uuid` はエラー）
  - 表ごとの grant（app_user / app_job / app_backup）と RLS・FORCE RLS はマイグレーションで付ける（A-01・A-03）。`db:roles` は入口の権限だけ
  - DB の `timezone = 'Asia/Tokyo'`（付録 A の注記）は未設定。A-01 か A-04 で判断する
  - SMTP（mailpit:1025）の接続先の変数名は A-07 で決める（`.env.example` はコメントだけ）
  - `pnpm-workspace.yaml` の `allowBuilds` に `esbuild: false` を足した（postinstall なしで動く）
- 使った枠（/usage の変化）: 未計測

### 資料の移行（2026-09-18）
- やったこと: 手元の `beachapp/` から `docs/p0-tasks.md`・`docs/agent_prompt.md`・`docs/history/`（`decisions-v0.9*.md`・`review-v0.8.md`）を移した（LF に統一、中身は同じ）。README の案内を更新
- 次への申し送り: `beachapp/` のほかのファイルは L-02 で移し済み（`repo-template/` はリポジトリ側が新しい）。今後は `beachapp/` を見ずにリポジトリの `docs/` を使う

### L-03（2026-09-17）
- やったこと: Next.js 16.3.5（App Router・TypeScript strict・Tailwind 4・ESLint 9・`src/`）を pnpm で作って移設。`engines` `>=24 <25`・`.nvmrc` `24`・`packageManager` `pnpm@12.4.2`。Vitest 5（`tests/unit/`・`vitest.config.mts`）と Playwright 1.63（`tests/e2e/`。WebKit 375×667・Chromium 360×640）。scripts: `dev` / `dev:poll` / `build` / `lint` / `typecheck` / `test`（TZ 2 回）/ `test:e2e`。`src/lib/site.ts` の `SITE_NAME`、`src/app/tokens.css`（CSS 変数の器）、仮のトップページ、ユニット 1 本・E2E 1 本
- 動作確認: `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:e2e` が通る。Windows のブラウザで http://localhost:3000 が開き、375px で横にはみ出さない（E2E で検査）
- 次への申し送り・既知の課題:
  - Windows（9p マウント）では Turbopack の自動再読み込みが効かない（コンテナの中で直しても同じ）。`pnpm dev:poll`（webpack + polling）を使う
  - `pnpm typecheck` は `next typegen && tsc --noEmit`（`next-env.d.ts` と型を生成してから検査）
  - Playwright のブラウザはコンテナのボリューム。作り直したら `post-create.sh` が入れ直す
- 使った枠（/usage の変化）: 未計測

### L-02（2026-09-17）
- やったこと: テンプレート・`docs/design.md`・`tools/split-design.sh`・`docs/legal/templates.md` をコピー。`CLAUDE.md`、`git init -b main`、`.gitignore`、`docs/design/`（節 80・付録 A の表 40）、`docs/adr/README.md`、`README.md`。リポジトリ名を beachball-portal に変更し、GitHub（https://github.com/naki27/beachball-portal.git・HTTPS）に push
- 動作確認: `bash tools/split-design.sh docs/design.md docs/design` が通り、「読む設計書」のファイルはすべてある
- 次への申し送り・既知の課題: 開発マシンは Windows 11。Rancher Desktop + `docker compose` で Dev Container を動かす（`docs/setup.md` §7）。改行は LF（`.gitattributes`）。L-02 のコミットメッセージの「元のファイルは CRLF」は誤りで、元から LF だった（Git Bash の `grep -c $'\r'` は LF のファイルでも全行に当たる。CR は `tr -cd '\r' < f | wc -c` で数える）
- 使った枠（/usage の変化）: 未計測
