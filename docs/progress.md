# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: **X-01（本番用の設定）**。起動時の環境変数の検査・Brevo の送信・送信数 8 割の警告・R2 のバックアップ用キーの分離・`pnpm storage:check`。**Phase 1a・1b・1c・1d・U・K は完了**
- 次のタスク: **X-02**（コンテナ・migrate の Job・デプロイの GitHub Actions）。X・H・Y・P のタスクは `docs/p1-tasks.md`（人の準備 `docs/deploy-prep.md` は 2026-10-02 に完了）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 残っている申し送り
### 本番の前に（X 系・運用）
- **X-01 でやったこと**: 起動時の環境変数の検査（`src/instrumentation.ts`→`src/lib/env/production.ts`。役割は app / job-mail / job-daily / migrate）、Brevo の `MailSender`（`src/lib/mail/brevo.ts`）、差出人名と Reply-To（`mailBranding()`）、送信数 8 割の警告（`src/lib/mail/daily-limit.ts`）、バックアップ用バケットを別のキーに（`R2_BACKUP_ACCESS_KEY_ID`・ADR 0036）、`pnpm storage:check`。本番の一覧と手順は `docs/ops.md` §9・§10
- **R2 は本物の R2 で未確認のまま**（キーがないため）。人が `.env.production.local` を用意して `pnpm storage:check` を流す（H-01）。Brevo の実送信も H-01・H-05。バックアップの鍵はローカルだと `.local-storage/backup-test-key.json`。控えた値は `docs/deploy-values.local.md`（Git に入れない）
- 公開用ファイルの配信は **ADR 0033（Workers）**。`entry.` のサブドメイン委任は無料プランでは不可（D-4 は「任せられない」）。Workers は X-05
- 日次ジョブの ① DB バックアップ・⑦ 最小インスタンス数は未実装（⑥ 大会資料の後始末は入っている）
- 保存期間: `RETENTION_DAYS`（`daily.ts`）に `entry_audits`・`export_logs` がない。足すときは `app_job` に delete の GRANT が要る（`0012` は select・insert だけ）
- E2E は CI に入れていない（入れるか決める）。運営画面に「アクセス記録」（`admin_access_logs`）と `mail_logs` を読む画面がない（RLS 外の表なので `SECURITY DEFINER` が要る）
- 法務の【要確認】（`docs/legal/*.md` の末尾）・らくらくスマートフォンの実機・`docs/ops.md` §8 の未決事項
- README の 1c の節が配信を「独自ドメインで」と書いたままで ADR 0033（Workers）と食い違う → X-05

### 小さな未実装・気になる点（どのタスクにも割り当てていない）
- 依頼メールの一斉送信・督促、前年度の名簿の取り込み、名簿の各形式の出力は P1。「追加の申告」で会員を**外す**のは運営の代理だけ（§5.12【仮】）
- 申込ページで管理者が定員を超えるときの「定員を超えています」の確認は未実装（サーバーは管理者なら通す・`submit-entry.ts`）
- 問い合わせは `?entryId=` を `contact_messages.entry_id` に入れるだけ。`tournament_id` は入れず、申込の画面から飛ぶ導線もない
- 個人登録だけの人にも `/`・マイページで「チームの代表者」と出る（`ROLE_LABEL`。`getMembership` がチームの種類を持たない）
- `/admin/trash` は全件を 1 ページに出す。`db:studio` は app_owner でつなぐのでテナント表が 0 件に見える（中身は `postgres` でつなぐ）
- 資料のタイトルを変えても公開用の名前（URL）は変えない（共有済みの URL を壊さないため）
- ADR 0007 の表示名 30 文字は §14-13 と突き合わせていない。規約の改定で同意を取り直す（`users.terms_version`）は P1
- `src/app/tokens.css`・`globals.css` のコメントが配色・節目の演出を「ADR 0027」と書いている（正しくは **0028**。0027 は操作ログ）

### 作業の注意（消さない）
- **登録ページで `fetch` の応答の本文を 2 回読まない**（`response.json()` のあとに同じ応答からエラーを読むと本文が空で、サーバーの文言が落ちる）。成功と失敗を 1 回の `json()` から取る
- E2E: **Turbopack（`pnpm dev`）を立てて、spec を 1 本ずつ `--workers=1` で流す**。`dev:poll`（webpack）だとルートの初回コンパイルに 10〜40 秒かかって待ちを超える。Turbopack は 9p でファイルの変更を拾わないので、コードを変えたら **`.next/dev` を消してから**立て直す。**全部いちどに流すと dev サーバーが落ちる**（コンテナのメモリ）のでファイルを分ける。先に全ページ・API を一度 curl で呼ぶ。`tests/e2e/fixtures.ts` の `test` を使い、`[data-hydrated]` を待ってから押す。ヘッドレスは PDF をダウンロードにするので `popup` を待たない
- **スクリーンショットを撮る前はページの入れ替えの終わりを待つ**（`screens.spec.ts` の `settled()`）。待たないと半透明の途中が写る
- **dev サーバーを付けっぱなしでスキーマを変えると、古い列のまま動いて 500 になる**（drizzle の `escapeName` で落ちる）。`pnpm db:migrate` のあとは dev サーバーを入れ直す
- `bb-link` を使うときは `no-underline` を付けない（下線は `bb-link` が引く）。選手側に `loading.tsx` は置けない（403・404 が 200 になる・ADR 0029）
- `processMailQueue` を呼ぶ DB テストは `mail.test.ts` だけ（送信待ちを取り合うため）。`mail_logs` の件数を数えるテストも同じ理由で足さない（`sentTodayWindow` を純粋関数で見る）。`purgeFromTrash` を呼ぶテストは後始末で `deletion_logs` を先に消す
- **`next build` では `register()`（instrumentation）は動かない**ので、本番の値がなくてもビルドは通る。検査が走るのは `next start` のあと（足りなければ名前だけ出して終了コード 1）
- `0011` の列を指定した `ON DELETE SET NULL` 3 か所は手で直した（drizzle は出せない・ADR 0019）。`0016` は drizzle の出力から `0014` で手で足した分を除いた。作り直すときも同じ
- 一時保存は画面を移る直前に `saveNow`。drizzle のエラー文は引数（宛先など）を含むので `sanitizeError()` か `cause.code` だけを出す。`"use client"` の部品から `node:` を使うモジュール（`publish.ts` など）を import しない
- コンテナを作り直したら `bash .devcontainer/post-create.sh`。`pkill -f` の検索語が自分のコマンドに含まれないよう変数で組み立てる
