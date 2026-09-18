# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-08 ログイン①: 確認番号の発行
- 次のタスク: A-09 ログイン②: 照合とセッション
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
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
