# 申し送りの記録（古いもの）

`docs/progress.md` から移した古い申し送り（新しいものを上に）。タスクでは読まない。

### A-08（2026-09-18）
- やったこと: `src/lib/auth/`: `cookies.ts`（名前と属性は 1 か所。`APP_BASE_URL` が https のときだけ `__Host-`・`Secure`）、`login-input.ts`（ブラウザでも使う正規化）、`login-code.ts`（乱数・HMAC・SHA-256。サーバー専用）、`rate-limit.ts`（`rate_limits` の UPSERT。メール 5/時・IP 20/時・全体 150/時）、`request-login-code.ts`（登録済みかどうかを見ないので文言も所要時間も同じ。番号は HMAC だけ保存。応答の前に送り `mail_logs` に sent/failed。再送は同じ試行 ID で、待ち時間 30→60→120 秒）、`login-client.ts`（sessionStorage を `useSyncExternalStore` で読む。`safeNext`）。`src/lib/api/{csrf,request}.ts`。`POST /api/auth/request`（Origin 検査 → 形式 400 → レート制限 429 → 発行 → Cookie `login_attempt` 15 分）。画面 `/login`（同意の一文）・`/login/code`（6 桁 1 欄・自動照合・間違えたら全選択・「あと N 秒で送れます」・もう一度送る）・`/login/help`（§11.3。ドメインのコピー・送り直し・問い合わせへ）。`src/hooks/use-hydrated.ts`（E2E が押してよい印 `data-hydrated`）、`tests/e2e/global-setup.ts`（ページを温める）
- 動作確認: lint / typecheck / test（TZ 2 回・111 本）、E2E 28 本 ×2（Mailpit に「【早良区協会】確認番号 123456」が届くところまで）
- 次への申し送り・既知の課題:
  - CSRF の Origin 検査は `Host`（前段があれば `x-forwarded-host`）と比べる。`request.url` は dev サーバーが localhost に書き換えるので使わない
  - `useSyncExternalStore` の getSnapshot は同じ値を返し続けること（`Date.now()` を毎回返すと「Maximum update depth exceeded」）
  - dev サーバー（webpack + polling）はコード変更後の初回のページ遷移でコンパイル中の応答を返すことがある。E2E は global-setup で温め、クライアント部品を押す前に `[data-hydrated]` を待つ（`networkidle` は HMR で終わらない）
  - キャリアの受信設定ページの URL（`help-form.tsx`）は人が確かめる。送信ドメインの表示は `MAIL_FROM` から
  - `POST /api/auth/verify`（照合・セッション・戻り先）は A-09。`/login/code` はそれを呼ぶ形で作ってある
- 使った枠（/usage の変化）: 未計測

### A-07（2026-09-18）
- やったこと: `src/lib/mail/`: `types.ts`（§11 の種別・`MailSender`）、`sender.ts`（`console` / `smtp`。`MAIL_PROVIDER=mailpit` は smtp の別名、接続先は `SMTP_URL`。console は本番で拒否。Brevo は X-01）、`outbox.ts`（`enqueueMail(tx, …)`。業務と同じトランザクションで `mail_logs` に queued。app_user は insert だけなので id はコードで作り RETURNING を使わない）、`templates.ts`（送る直前に組み立て。件名は【協会名】/【サイト名】。`test` と、A-08 用の `composeLoginCodeMail`）、`queue.ts`（`for update skip locked`。失敗は 1・5・15・60・180 分後に再試行、5 回で failed。雛形がない種別は再試行せず failed。エラー欄はメールアドレスを消す）。`pnpm job:mail`（app_job。失敗があれば exit 1）・`pnpm mail:test <宛先>`。nodemailer を追加
- 動作確認: lint / typecheck / test（TZ 2 回・97 本）、`pnpm mail:test` → `pnpm job:mail` → Mailpit の API で「【早良区協会】テスト送信」を確認
- 次への申し送り・既知の課題:
  - drizzle のエラー文（`DrizzleQueryError.message`）にはクエリの引数（宛先など）が入る。ログに出すときは `sanitizeError()` か `cause.code` だけにする
  - §11.2 の「当日の送信数が上限の 8 割で警告」は Brevo と一緒に X-01 で
  - `mail_logs` を管理画面で読む関数（§5.14）はまだない。必要になったタスクで `SECURITY DEFINER` を足す
- 使った枠（/usage の変化）: 未計測

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

### A-09（2026-09-18）
- やったこと: `src/lib/auth/verify-login-code.ts`（Cookie の試行 ID → その試行の未使用・未期限の直近 3 個と HMAC を時間一定で比較。失敗は試行の未使用行すべての `attempt_count` を進め、5 回で全部無効。失敗はメール 10/時・IP 30/時で `rate_limits` に数える。一致したら同じメールの番号を全部無効 → users がなければ作成（`terms_version`・`terms_accepted_at`・`email_verified_at`）→ セッション作成）、`session.ts`（乱数 ID・DB は SHA-256・10 日・延長の書き込みは 1 日 1 回・90 日の上限。Cookie の Max-Age は 90 日で DB が正）、`redirect-after-login.ts`（`next` → 役割を持つ協会が 1 つならその協会 → `/mypage`）、`principal.ts` を本物に（Cookie → sessions → platform_admins。`getMembership` は withTenant で association_admins / team_admins / members＋team_members）。`POST /api/auth/verify`（失敗は理由によらず 400「番号が違います」＋remaining）・`POST /api/auth/logout`・`GET /api/me`。ヘッダにログイン／ログアウト（`AuthMenu`。ログアウトは `clearAllDrafts` してから）。`forbidden.tsx` は自分で判定（`whoCanSee(url)`）。CI に `.env` 相当の環境変数。ADR 0005
- 動作確認: lint / typecheck / test（TZ 2 回・119 本。§9.2 の 10 分・1 回・5 回・他人の試行・直近 3 個・90 日はテスト用の時計で）、E2E 30 本（ログイン → 元のページ → 開き直してもログイン中 → ログアウト。Cookie は HttpOnly・Lax・Path=/）
- 次への申し送り・既知の課題:
  - テナント管理者の同時ログインの制限（409・30 分の逃げ道・`last_seen_at` を 1 分に 1 回）は A-10。`verifyLoginCode()` のセッション作成の前と `loadSession()` に入れる
  - ページから `forbidden.tsx` へ値は渡せない（React の cache は境界の描画で共有されない）。403 の「誰なら見られるか」は `whoCanSee()` の URL の表。画面を足すときに規則を足す（ADR 0003 を訂正済み）
  - E2E はローカルの IP 単位のレート制限（20/時）に当たるので、global-setup がテスト前にログイン系の `rate_limits` の行を消す。API も先に POST してコンパイルさせる
  - `/mypage` はまだない（A-13）。戻り先の ④ は今は 404 になる
- 使った枠（/usage の変化）: 未計測

### A-10（2026-09-18）
- やったこと: `0005` の `SECURITY DEFINER` 関数 `current_user_is_association_admin()`（どこかの協会の管理者か。RLS 下で読むため）。`verifyLoginCode()` を並べ替え: 一致 → users を決める → 管理者なら users の行をロック → 30 分以内に操作のある有効なセッションがあれば `admin_session_exists`（番号は使用済みにしない。API は 409）、なければ古いセッションを終了 → ここで番号を使用済みに → セッション作成。`session.ts`: 管理者は `last_seen_at` を 1 分に 1 回更新（ほかは 1 日 1 回）、`endUserSessions(db, userId, { exceptSessionId })`、`activeSessionsOf`。`pnpm dev:grant-admin <メール> <スラッグ>`
- 動作確認: lint / typecheck / test（TZ 2 回・125 本。§9.2 の受け入れ条件 4 つ＋1 分の更新＋まとめて終了）、E2E 32 本（2 つのブラウザで 409 → A のログアウト → B が同じ番号で入る）
- 次への申し送り・既知の課題:
  - E2E は dev サーバーでは 1 回のログインに 20 秒ほどかかる。テスト時間は全体 60 秒、2 台分の流れは 120 秒にした。`pnpm test` と `pnpm test:e2e` を同時に流すと詰まって落ちる
  - `dev-admin@example.com` を早良区協会の管理者にしてある（ローカルの DB だけ。`pnpm dev:grant-admin` の確認用）
- 使った枠（/usage の変化）: 未計測

### A-11（2026-09-18）
- やったこと: `0006`: `platform_association_stats()` を作り直し（`admins`・`pending_admin_invitations` を追加）、`platform_association_admins()`（テナント管理者のメール・表示名。運営管理者のときだけ）。`src/lib/platform/associations.ts`（`createAssociationTenant`: 協会 → `setTenant` → プリセット 18 件 → 招待の行 → `admin_access_logs`、`updateAssociation`: スラッグ変更で旧スラッグを履歴へ、`enterTenant` / `leaveTenant`: `sessions.entered_*`＋記録。`PlatformError` は 400/409）、`src/lib/repo/{platform,admin-access-logs}.ts`、`src/lib/api/platform.ts`（`requirePlatformAdmin`）。API: `GET/POST /api/platform/associations`、`PATCH /api/platform/associations/[id]`、`POST/DELETE …/[id]/enter`。画面: `/platform`（一覧・件数・作成）、`/platform/associations/[id]`（件数・管理者・入る／出る・名前と URL）。`[slug]` layout に「運営管理者として ◯◯ を表示中」の帯（出る）。`jsonError` に 400・429
- 動作確認: lint / typecheck / test（TZ 2 回・129 本）、E2E 36 本（運営管理者でログイン → 協会を作る → 一覧 → スラッグ変更で 308 → 入る → 帯 → 出る）
- 次への申し送り・既知の課題:
  - 招待のメール送信・承諾・取り消しは A-12（作成時は `association_admin_invitations` の行だけ入る。作成画面の文言もそのとき直す）
  - `platform_association_stats()` の `open_tournaments` は B-01 で。「アクセス記録」「運営者宛ての問い合わせ」の画面は A-22 以降
  - E2E は並列 2（`workers: 2`）にした。4 つ以上のログインの流れが同時に走ると dev サーバーが詰まる。全体で 3 分ほど
  - ローカルで `/platform` を触るには `.env` の `SUPER_ADMIN_EMAILS` に自分のアドレスを入れて `pnpm db:seed`
- 使った枠（/usage の変化）: 未計測

### A-12（2026-09-18）
- やったこと: `src/lib/platform/admin-invitations.ts`（招待: 同じアドレスに返事待ち／期限切れがあれば同じ行を再送、管理者＋返事待ちが 5 名なら 409、既に管理者なら 409。再送・取り消し・解除（解除はセッションの `entered_*` も消す）。すべて `admin_access_logs` に記録、メールは送信待ちに積む）、`src/lib/invitations/admin-accept.ts`（承諾: `my_pending_invitations()` で本人宛てを確認 → 行をロック → pending・期限内・確認済みアドレスの一致・5 名未満 → `association_admins` に `granted_by` 付きで追加 → ほかのセッションを終了。拒否: rejected にして招待した運営管理者にメール）。テナントの作成時も招待メールを積む。メールの雛形を「送る直前に協会に固定して ID から行を読む」非同期の形にし、招待・断られた・期限切れの 3 種を追加（本文に協会名・トップの URL・ログインに使うアドレス・期限「9月17日（木）まで」・いつものブラウザで。ログイン用リンクなし）。`date.ts` に `formatDateWithWeekday`。API: `POST/DELETE /api/platform/associations/[id]/admin-invitations`、`DELETE …/admins/[userId]`、`GET /api/me/invitations`、`POST /api/me/invitations/[id]/accept|reject`。画面: `/invitations`、運営画面の「協会の管理者」の節（招待・再送・取り消し・外す）
- 動作確認: lint / typecheck / test（TZ 2 回・135 本。§5.14 の受け入れ条件 3 つ＋再送・取り消し・拒否の通知）、E2E 38 本（招待 → job:mail → Mailpit の本文 → 本人がログイン → `/invitations` で参加 → `/sawara/admin` が開く）
- 次への申し送り・既知の課題:
  - 期限切れの検出（`expired` にして招待した人に知らせる）は日次ジョブ（A-27）。雛形 `association_admin_invitation_expired` は用意済み
  - 選手・代表者の招待（`team_invitations`）への返事は A-19。`/invitations` には表示だけ出る
  - E2E の global-setup がテストの残骸（`e2e-%` のアカウント・協会・招待）を毎回消す。タイムアウトで止まったテストは finally まで進まないため
  - 運営画面の招待の欄は `getByLabel("メールアドレス", { exact: true })` で取る（連絡先の欄と重なる）
- 使った枠（/usage の変化）: 未計測

### A-13（2026-09-18）
- やったこと: `/`（役割を持つ協会の一覧と役割。リダイレクトしない・未ログインは 403）、`/mypage`（協会ごとの枠・返事待ちの招待の件数・ログインのアドレス・表示名の変更・ログアウト）、ヘッダ右上の「メニュー」（マイページ・運営管理・協会を切り替える（2 つ以上のときだけ。運営管理者は全協会）・ログアウト）、協会のトップの骨組み（「あなたのやること」はログイン中かつ項目があるときだけ・「受付中の大会」は空の案内）。`listMyAssociations`（`my_association_ids()`）・`listAllAssociations`、`src/lib/repo/users.ts`、`src/lib/account/display-name.ts`。API: `PATCH /api/me`（表示名）、`GET /api/me/associations`。ADR 0007（メニューの形・ログアウト後の行き先・表示名 30 文字）
- 動作確認: lint / typecheck / test（TZ 2 回・145 本）、E2E 40 本（2 つの協会の管理者でログイン → `/` に両方 → メニューで切り替え → マイページで表示名を変更）
- 次への申し送り・既知の課題:
  - ログアウトはヘッダの「メニュー」の中に移した。E2E では `page.locator("header summary", { hasText: "メニュー" })` を開いてから押す。ログアウト後は協会のページならその協会のトップ、それ以外は `/login`
  - マイページの協会の枠の中身（代表者を務めるチーム）は A-14 で `src/app/(site)/mypage/page.tsx` の枠に足す。「あなたのやること」の中身は `src/app/[slug]/page.tsx` の `todos`（B-06・D 系）
  - 表示名の上限 30 文字は §14-13 を読まずに決めた（ADR 0007）。食い違えば直す
  - ファイルを直したあとの最初の E2E は、dev サーバーの再コンパイルでログインの照合が 15 秒を超えて落ちることがある。もう一度流すと通る
- 使った枠（/usage の変化）: 未計測
