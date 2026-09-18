# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-06 画面の共通部品
- 次のタスク: A-07 メールの土台（送信待ちの表と送信ジョブ）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### A-06（2026-09-18）
- やったこと: レイアウトを route group `(site)`（ヘッダはサイト名）と `[slug]`（ヘッダは協会名。タブの題名は `title.absolute` ＋ template `%s｜協会名`）に分け、フッタ（`/privacy`・`/terms`）と電波の帯・一時保存の掃除はルートの layout。部品 `src/components/ui/`: `Button`（pending で「送信しています…」＋押せない）、`TextField`（理由・赤枠・1 回揺れる・`aria-describedby`）、`Message`（自動で消えない・`aria-live`・成功はチェックが描かれる）、`UndoBar`、`ErrorSummary`（「N か所に入力の誤りがあります」→欄へ移動）、`DelayedSkeleton`（1 秒・3 秒）、`OfflineBanner`、`Spinner`・`CheckIcon`。`src/lib/draft.ts`（純粋関数。キー `draft:<協会>:<画面>[:<対象>]`、7 日、`clearAllDrafts`）と `src/hooks/use-draft.ts`（`useSyncExternalStore`）。`tokens.css` に色と動きの変数（`--motion-fast/base/slow/spin`。`prefers-reduced-motion` で 0ms）、`globals.css` に `bb-*` の動きのクラスと Tailwind の色の対応。`/dev/ui`（production は 404）。ADR 0004
- 動作確認: lint / typecheck / test（TZ 2 回・92 本）、E2E 22 本（`/dev/ui` の操作と一時保存の復元、フッタ、タブの題名）。375×667 のスクリーンショットは `test-results/…/dev-ui.png`
- 次への申し送り・既知の課題:
  - 効果的な確認: http://localhost:3000/dev/ui で部品を触る。「視差効果を減らす」（Windows は「設定 → アクセシビリティ → 視覚効果 → アニメーション効果」オフ）で動きが消え、文字は残る
  - React Compiler 系の lint（`react-hooks/set-state-in-effect`・`purity`・`refs`）が有効。effect の中で直接 setState しない、render で `Date.now()` を呼ばない。ブラウザの状態（localStorage・navigator.onLine）は `useSyncExternalStore` で読む
  - `inputmode="kana"` は規格にないので付けない（ADR 0004）。生年月日の入力部品は A-16
  - ヘッダの右側（ログイン・メニュー）は `SiteHeader` の `right` に A-08・A-13 で入れる
- 使った枠（/usage の変化）: 未計測

### A-05（2026-09-18）
- やったこと: `src/lib/slug.ts`（予約語・形式・`redirectTargetFor`・`slugFromUrl`）、`src/lib/resolve-association.ts`（解決順 ①〜④の 1 か所。React `cache`）、`0004` の `SECURITY DEFINER` 関数 `resolve_association_slug()`（旧スラッグの表は RLS 下なので）、`src/lib/page/require-association.ts`（layout と page が呼ぶ。404 は `notFound()`、旧スラッグは `permanentRedirect` = 308）、`src/lib/api/{resolve,errors}.ts`（API は 404 の JSON / 308 の Response）。`src/lib/authz.ts`（ロール・包含・§3.2 の権限表をデータで持つ `can()`・`checkAccess()`。P1 の 2 段階目は `AdminPolicy` に足す）、`src/lib/auth/principal.ts`（A-09 までアンノウン固定）。403 は `forbidden()`（`experimental.authInterrupts`）＋ `src/lib/page/forbidden.ts` で理由を渡す。エラーページ: `not-found.tsx` / `forbidden.tsx`（ルートと `[slug]`）、`error.tsx`、`global-error.tsx`、部品 `src/components/{error-screen,forbidden-screen,conflict-screen}.tsx`・`button-classes.ts`。`src/proxy.ts`（`x-url` を付けるだけ）。`robots.ts`・meta の noindex・`X-Robots-Tag`。画面 `/[slug]`（協会のトップの仮）と `/[slug]/admin`（403 の確認用）。ADR 0003
- 動作確認: lint / typecheck / test（TZ 2 回・86 本）、E2E 16 本（WebKit・Chromium）、curl で `/sawara` 200・`/nothing` 404・`/admin` 404・`/sawara/admin` 403・robots.txt・`X-Robots-Tag`
- 次への申し送り・既知の課題:
  - 403 / 404 の中身はクライアント側で RSC の payload から描画される（HTML の静的な部分には入らない）。Playwright は `127.0.0.1` で開くので `next.config.ts` に `allowedDevOrigins: ["127.0.0.1"]` を入れた（開発時だけ効く）
  - ログインのボタンは `/login?next=<元の URL>`。A-08 の `/login` は `next` を受けてログイン後に戻す（外部の URL は拒否）
  - `getPrincipal()` / `getMembership()` は仮（アンノウン固定）。A-09・A-13 で本物にする。`sessionState: "expired"` の 403 も A-09 から
  - `ConflictScreen`（409）は部品だけ。使うのは B-07 以降（`contactHref` は A-22 の URL）
  - コンテナを `docker compose up` で作り直したら `bash .devcontainer/post-create.sh` を流す（Playwright の OS ライブラリが消えて E2E が落ちる）
- 使った枠（/usage の変化）: 未計測

### A-04（2026-09-18）
- やったこと: `src/lib/date.ts`（`PlainDate`・`todayInTokyo`・`startOfDayTokyo`・`endOfDayTokyo` は付録 D のとおり。加えて DB の date 型／フォーム用に `formatPlainDate`・`parsePlainDate`（存在しない日付は null）・`isValidPlainDate`・`comparePlainDate`）、`src/lib/normalize.ts`（付録 B のとおり）。テスト: §8.2 の 10 例すべて＋補足、日付は瞬間を固定して境界（UTC 15:00）と往復を検査
- 動作確認: lint / typecheck / test（TZ 2 回・44 本）
- 次への申し送り: DB の `timezone = 'Asia/Tokyo'` は設定しない（業務の日付はすべて `date.ts` で日本時間に解釈し、SQL の `current_date` / `age()` は使わない方針・§6.3）。年齢は B-02 の `age.ts`
- 使った枠（/usage の変化）: 未計測

### A-03（2026-09-18）
- やったこと: `0003_rls-and-grants.sql`（テナント表 11 個に enable + force + policy `<表>_tenant`。式は関数 `current_association_id()` = `nullif(current_setting('app.association_id', true), '')::uuid` の 1 か所。表ごとの grant（app_user / app_job / app_backup / app_definer）。`SECURITY DEFINER` 関数 `my_association_ids()`・`my_pending_invitations()`・`platform_association_stats()`（所有者 app_definer。execute は関数ごとに revoke → app_user に grant）。`db:roles` に app_definer への `usage, create` と `grant app_definer to app_owner` を追加。`src/db/tenant.ts` に `setTenant` / `withTenantOn(db, …)` / `withTenant`。`src/lib/repo/{scope,teams,members}.ts`（`(tx, associationId, …)` で省略不可、削除済みの除外が既定。`includeDeleted` は削除済み画面だけ）。seed は `withTenantOn` の中で入れる（FORCE で所有者にも効く）。テスト: `tests/db/rls.test.ts`（SET LOCAL なし 0 件・別協会は見えない・別協会へ書けない 42501・所有者にも効く・grant）、`tests/unit/repo-types.test.ts`（`@ts-expect-error`）。ADR 0002（新しい表に同じ形で足す手順）
- 動作確認: `db:roles` → `db:migrate`、`db:reset` の一連、lint / typecheck / test（TZ 2 回・22 本）、`/api/health` ok
- 次への申し送り・既知の課題:
  - `platform_association_stats()` の `open_tournaments` は B-01 で `tournaments` を数える形に `create or replace` する（いまは 0）
  - `association_slug_history` にも RLS が効くので、旧スラッグ → 協会の解決（`resolveAssociation`、A-05）はテナント未設定では読めない。A-05 で `SECURITY DEFINER` 関数を足す（ADR に残す）
  - `drizzle-kit migrate` は失敗してもエラー文を出さない（exit 1 だけ）。原因は `psql -U app_owner -v ON_ERROR_STOP=1 --single-transaction -f <SQL>` で見る（全部戻るので安全）
  - `db:studio` は app_owner でつなぐので、テナント表は 0 件に見える（FORCE）。中身を見るときは `postgres` でつなぐか、A-28 で studio 用の設定を考える
- 使った枠（/usage の変化）: 未計測
