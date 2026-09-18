# 申し送りの記録（古いもの）

`docs/progress.md` から移した古い申し送り（新しいものを上に）。タスクでは読まない。

### A-03（2026-09-18）
- やったこと: `0003_rls-and-grants.sql`（テナント表 11 個に enable + force + policy `<表>_tenant`。式は関数 `current_association_id()` = `nullif(current_setting('app.association_id', true), '')::uuid` の 1 か所。表ごとの grant（app_user / app_job / app_backup / app_definer）。`SECURITY DEFINER` 関数 `my_association_ids()`・`my_pending_invitations()`・`platform_association_stats()`（所有者 app_definer。execute は関数ごとに revoke → app_user に grant）。`db:roles` に app_definer への `usage, create` と `grant app_definer to app_owner` を追加。`src/db/tenant.ts` に `setTenant` / `withTenantOn(db, …)` / `withTenant`。`src/lib/repo/{scope,teams,members}.ts`（`(tx, associationId, …)` で省略不可、削除済みの除外が既定。`includeDeleted` は削除済み画面だけ）。seed は `withTenantOn` の中で入れる（FORCE で所有者にも効く）。テスト: `tests/db/rls.test.ts`（SET LOCAL なし 0 件・別協会は見えない・別協会へ書けない 42501・所有者にも効く・grant）、`tests/unit/repo-types.test.ts`（`@ts-expect-error`）。ADR 0002（新しい表に同じ形で足す手順）
- 動作確認: `db:roles` → `db:migrate`、`db:reset` の一連、lint / typecheck / test（TZ 2 回・22 本）、`/api/health` ok
- 次への申し送り・既知の課題:
  - `platform_association_stats()` の `open_tournaments` は B-01 で `tournaments` を数える形に `create or replace` する（いまは 0）
  - `association_slug_history` にも RLS が効くので、旧スラッグ → 協会の解決（`resolveAssociation`、A-05）はテナント未設定では読めない。A-05 で `SECURITY DEFINER` 関数を足す（ADR に残す）
  - `drizzle-kit migrate` は失敗してもエラー文を出さない（exit 1 だけ）。原因は `psql -U app_owner -v ON_ERROR_STOP=1 --single-transaction -f <SQL>` で見る（全部戻るので安全）
  - `db:studio` は app_owner でつなぐので、テナント表は 0 件に見える（FORCE）。中身を見るときは `postgres` でつなぐか、A-28 で studio 用の設定を考える
- 使った枠（/usage の変化）: 未計測

### A-02（2026-09-18）
- やったこと: `src/db/schema/members.ts`（members・member_aliases）と `teams.ts`（teams・team_members・team_admins・team_invitations）、`0002_teams-and-members.sql`（付録 A と突き合わせ済み。子は `(association_id, 親 id)` の複合 FK、GIN は `gin_trgm_ops`、部分一意 7 本）。`birth_date` は `date({ mode: "string" })`（JS の Date にしない・§7.0）。テスト `tests/db/constraints.test.ts`（別協会の親を指す INSERT が失敗・削除済みと同じ内容で登録し直せる。app_owner の transaction を最後に rollback し、失敗させる INSERT は savepoint = 入れ子の transaction）
- 動作確認: `db:migrate` ×2（19 表）、lint / typecheck / test（TZ 2 回・14 本）
- 次への申し送り: members / teams の `association_id` は cascade なし（付録 A どおり。協会は物理削除しない）。Postgres のエラーコードは drizzle の `DrizzleQueryError` の `cause.code` で取る（テストの `pgErrorCode`）
- 使った枠（/usage の変化）: 未計測

### A-01（2026-09-18）
- やったこと: `src/db/schema/`（associations / users / auth = sessions・login_codes・rate_limits / admins = platform_admins・association_admins・association_admin_invitations・association_slug_history / logs = admin_access_logs・deletion_logs・mail_logs / category-presets。`schema.ts` から再エクスポート。列名は `casing: "snake_case"`（config と client の両方）、`citext` は customType）。`0001_foundation.sql`（13 表。付録 A の DDL と突き合わせ済み。`mail_logs.entry_id` は列だけ）。`src/lib/presets/default.ts`（18 件）。`src/db/seed.ts` と `pnpm db:seed`（app_owner で実行。早良区協会・プリセット・`SUPER_ADMIN_EMAILS` の運営管理者。あるものは触らない）。`client.ts` に `createDb(url)`。`db:reset` と CI の末尾に `db:seed`。ADR 0001
- 動作確認: `db:generate` → `db:migrate` ×2 → `db:seed` ×2（2 回目は 0 件追加）、`db:reset` の一連（drop → roles → migrate → seed）、lint / typecheck / test（TZ 2 回・10 本）、`/api/health` ok、`pnpm db:studio` が 4983 で起動（Windows の Chrome で https://local.drizzle.studio ）
- 次への申し送り・既知の課題:
  - 表の grant と RLS（ポリシーは `nullif(current_setting(…, true), '')::uuid`・FORCE）は A-03 で 1 つのマイグレーションにまとめる（ADR 0001）。それまで app_user は表を読めない
  - `mail_logs.entry_id` の FK（on delete set null）は B-01 で足す。DB の timezone は A-04 で判断
  - seed のテスト（`tests/db/seed.test.ts`）は自分が作った運営管理者だけを消す。協会とプリセットは残す
  - drizzle-kit の生成物（`meta/`）は手で直さない。作り直すときは SQL・snapshot・journal の項目を消して `db:generate --name=…`
  - コンテナの中で `pkill -f` を使うと自分のシェルにも一致する。`drizzle-ki[t]` のように書く
- 使った枠（/usage の変化）: 未計測

### L-05（2026-09-18）
- やったこと: `.github/workflows/ci.yml`（pull request と main への push。ubuntu-24.04、Postgres 16 のサービスコンテナ、pnpm は `packageManager`・Node は `.nvmrc` から。`db:roles` → `db:migrate` → lint → typecheck → test）。デプロイは入れていない（X-02）
- 動作確認: push で Actions が緑（https://github.com/naki27/beachball-portal/actions/runs/35294609125 。約 1 分）
- 次への申し送り: 接続先は job の `env:` で渡す（CI では `.env` を作らない）。E2E は CI に入れていない（ブラウザの取得が重い。A-29 で判断）。actions は checkout v7 / setup-node v7 / pnpm/action-setup v6
- 使った枠（/usage の変化）: 未計測

### L-04（2026-09-18）
- やったこと: drizzle-orm 0.45・pg 8.23（本体）、drizzle-kit 0.31・@types/pg・tsx（開発）。`.env.example`（§6.3 のローカル分。ロールのパスワードは各 `*_DATABASE_URL` に持たせ、`POSTGRES_ADMIN_URL` を追加）と `src/db/env.ts`（Node 24 の `process.loadEnvFile`。dotenv は入れない）。scripts: `db:roles`（5 ロール＋DB への接続・public スキーマの権限。何度でも）/ `db:reset`（ローカルだけ。drop → roles → migrate）/ `db:generate` / `db:migrate` / `db:studio`。`drizzle.config.ts`（app_owner・出力 `src/db/migrations/`）、`0000_extensions.sql`（pg_trgm・citext）。`src/db/client.ts`（Pool は globalThis に 1 つ。`DB_POOL_MAX`、既定 5）、`src/db/tenant.ts` の `withTenant(associationId, tx => …, { userId? })`（transaction の冒頭で `set_config(…, true)` = SET LOCAL）。`GET /api/health`。テスト `tests/db/with-tenant.test.ts`（プール 1 接続で、外に漏れないことも確認）
- 動作確認: `db:roles`・`db:migrate` を 2 回ずつ、`db:reset`（拒否 2 条件と本体）、lint / typecheck / test（TZ 2 回・7 本）が通る。Windows から http://localhost:3000/api/health → `{"ok":true}`、http://localhost:8025 が開く。E2E は画面を変えていないので流していない
- 次への申し送り・既知の課題:
  - `current_setting('app.association_id', true)` は一度も設定していなければ NULL だが、SET LOCAL したトランザクションが終わったあとは `''` になる。A-03 の RLS ポリシーは `nullif(current_setting(…, true), '')::uuid` の形にする（`''::uuid` はエラー）
  - 表ごとの grant（app_user / app_job / app_backup）と RLS・FORCE RLS はマイグレーションで付ける（A-01・A-03）。`db:roles` は入口の権限だけ
  - DB の `timezone = 'Asia/Tokyo'`（付録 A の注記）は未設定。A-04 で判断する
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
