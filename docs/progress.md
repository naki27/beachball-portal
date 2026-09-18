# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-09 ログイン②: 照合とセッション（人の確認待ち）
- 次のタスク: A-10 テナント管理者の同時ログインの制限
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### A-09（2026-09-18）
- やったこと: `src/lib/auth/verify-login-code.ts`（Cookie の試行 ID → その試行の未使用・未期限の直近 3 個と HMAC を時間一定で比較。失敗は試行の未使用行すべての `attempt_count` を進め、5 回で全部無効。失敗はメール 10/時・IP 30/時で `rate_limits` に数える。一致したら同じメールの番号を全部無効 → users がなければ作成（`terms_version`・`terms_accepted_at`・`email_verified_at`）→ セッション作成）、`session.ts`（乱数 ID・DB は SHA-256・10 日・延長の書き込みは 1 日 1 回・90 日の上限。Cookie の Max-Age は 90 日で DB が正）、`redirect-after-login.ts`（`next` → 役割を持つ協会が 1 つならその協会 → `/mypage`）、`principal.ts` を本物に（Cookie → sessions → platform_admins。`getMembership` は withTenant で association_admins / team_admins / members＋team_members）。`POST /api/auth/verify`（失敗は理由によらず 400「番号が違います」＋remaining）・`POST /api/auth/logout`・`GET /api/me`。ヘッダにログイン／ログアウト（`AuthMenu`。ログアウトは `clearAllDrafts` してから）。`forbidden.tsx` は自分で判定（`whoCanSee(url)`）。CI に `.env` 相当の環境変数。ADR 0005
- 動作確認: lint / typecheck / test（TZ 2 回・119 本。§9.2 の 10 分・1 回・5 回・他人の試行・直近 3 個・90 日はテスト用の時計で）、E2E 30 本（ログイン → 元のページ → 開き直してもログイン中 → ログアウト。Cookie は HttpOnly・Lax・Path=/）
- 次への申し送り・既知の課題:
  - テナント管理者の同時ログインの制限（409・30 分の逃げ道・`last_seen_at` を 1 分に 1 回）は A-10。`verifyLoginCode()` のセッション作成の前と `loadSession()` に入れる
  - ページから `forbidden.tsx` へ値は渡せない（React の cache は境界の描画で共有されない）。403 の「誰なら見られるか」は `whoCanSee()` の URL の表。画面を足すときに規則を足す（ADR 0003 を訂正済み）
  - E2E はローカルの IP 単位のレート制限（20/時）に当たるので、global-setup がテスト前にログイン系の `rate_limits` の行を消す。API も先に POST してコンパイルさせる
  - `/mypage` はまだない（A-13）。戻り先の ④ は今は 404 になる
- 使った枠（/usage の変化）: 未計測

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
