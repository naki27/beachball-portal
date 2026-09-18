# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-03 RLS と withTenant・リポジトリ層
- 次のタスク: A-04 日付と正規化の関数
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
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
