# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: **`main` を `feature/cd` に取り込み、重複実装を解消**したうえで、**U-04（一覧と登録の分離）を会員管理と大会資料にも適用**。**Phase 1a・1b・1c・1d・U・K は完了**
- 次のタスク: **X-01**（本番用の設定）。X・H・Y・P のタスクは `docs/p1-tasks.md`（人の準備 `docs/deploy-prep.md` は 2026-10-02 に完了）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## このマージについて（2026-10-03・必ず読む）
- **C-01〜D-05（大会資料・年度更新）は `feature/cd` の実装を採用**。`main` 側の同じ機能（`admin/memberships.ts`・`approval-list.tsx`・`period-fields/open-form.tsx`・`document-fields/list/upload-form.tsx`・`documents/keys.ts`・`memberships/new` と `documents/new` の画面・`api/[slug]/admin/memberships/*`）は**削除した**
- **U-01〜U-07・K-01・K-02・利用者の操作ログ・`docs/ops.md` のサイトマップと運用フロー図は `main` のものを残した**。共有ページ（トップ・大会詳細・チーム詳細・名簿・管理トップ）は main の UI を土台に、feature/cd の資料・会員への導線だけを接いだ
- U-04 を会員管理と大会資料にも適用した: `/admin/memberships/new`（受付の開始）と `/admin/tournaments/[id]/documents/new`（資料の追加）を一覧から分け、
  成功したら一覧へ戻して `?added=<id>` で `bb-highlight`。入力欄は `period-fields.tsx` / `document-fields.tsx` に分けて行の編集と共用。
  両画面を `PageMain`/`PageHeader`/`Section`/`Card`/`Badge`/`bb-link` に載せ替えた（素の `<main>` をやめた）
- ADR の採番が衝突したので、feature/cd の 0027〜0029 を **0033〜0035** に採番し直した（main の 0027〜0032 はそのまま）。参照は `deploy-prep.md`・`p1-tasks.md` を直した
- マイグレーションは **feature/cd の 0016・0017 ＋ main の 0018・0019**。`meta/0018`・`0019` のスナップショットは `tournament_documents` を feature/cd の形に直し、`prevId` をつなぎ直した（`pnpm db:generate` が余計な差分を出さないこと）
- README の 1c の節は配信を「独自ドメインで」と書いたままで、**ADR 0033（Workers で配信）と食い違っている**。X-05 で直す

## 残っている申し送り
### 本番の前に（X 系・運用）
- R2（`src/lib/storage/r2.ts`）は**本物の R2 で未確認**（`Content-Disposition`・`Cache-Control` を含む）。§11.2 の送信数 8 割の警告も未実装 → X-01。バックアップの鍵はローカルだと `.local-storage/backup-test-key.json`。3 バケットに 1 組のキーなのでバックアップ用のキーを X-03 で分ける。控えた値は `docs/deploy-values.local.md`（Git に入れない）
- 公開用ファイルの配信は **ADR 0033（Workers）**。`entry.` のサブドメイン委任は無料プランでは不可（D-4 は「任せられない」）。Workers は X-05
- 日次ジョブの ① DB バックアップ・⑦ 最小インスタンス数は未実装（⑥ 大会資料の後始末は入っている）
- 保存期間: `RETENTION_DAYS`（`daily.ts`）に `entry_audits`・`export_logs` がない。足すときは `app_job` に delete の GRANT が要る（`0012` は select・insert だけ）
- E2E は CI に入れていない（入れるか決める）。運営画面に「アクセス記録」（`admin_access_logs`）と `mail_logs` を読む画面がない（RLS 外の表なので `SECURITY DEFINER` が要る）
- 法務の【要確認】（`docs/legal/*.md` の末尾）・らくらくスマートフォンの実機・`docs/ops.md` §8 の未決事項

### 小さな未実装・気になる点（どのタスクにも割り当てていない）
- 依頼メールの一斉送信・督促、前年度の名簿の取り込み、名簿の各形式の出力は P1。「追加の申告」で会員を**外す**のは運営の代理だけ（§5.12【仮】）
- 申込ページで管理者が定員を超えるときの「定員を超えています」の確認は未実装（サーバーは管理者なら通す・`submit-entry.ts`）
- 問い合わせは `?entryId=` を `contact_messages.entry_id` に入れるだけ。`tournament_id` は入れず、申込の画面から飛ぶ導線もない
- 個人登録だけの人にも `/`・マイページで「チームの代表者」と出る（`ROLE_LABEL`。`getMembership` がチームの種類を持たない）
- `/admin/trash` は全件を 1 ページに出す。`db:studio` は app_owner でつなぐのでテナント表が 0 件に見える（中身は `postgres` でつなぐ）
- 資料のタイトルを変えても公開用の名前（URL）は変えない（共有済みの URL を壊さないため）
- ADR 0007 の表示名 30 文字は §14-13 と突き合わせていない。規約の改定で同意を取り直す（`users.terms_version`）は P1

### 作業の注意（消さない）
- **登録ページで `fetch` の応答の本文を 2 回読まない**（`response.json()` のあとに同じ応答からエラーを読むと本文が空で、サーバーの文言が落ちる）。成功と失敗を 1 回の `json()` から取る
- E2E: **Turbopack（`pnpm dev`）を立てて、spec を 1 本ずつ `--workers=1` で流す**。`dev:poll`（webpack）だとルートの初回コンパイルに 10〜40 秒かかって待ちを超える。Turbopack は 9p でファイルの変更を拾わないので、コードを変えたら **`.next/dev` を消してから**立て直す。**全部いちどに流すと dev サーバーが落ちる**（コンテナのメモリ）のでファイルを分ける。先に全ページ・API を一度 curl で呼ぶ。`tests/e2e/fixtures.ts` の `test` を使い、`[data-hydrated]` を待ってから押す。ヘッドレスは PDF をダウンロードにするので `popup` を待たない
- **スクリーンショットを撮る前はページの入れ替えの終わりを待つ**（`screens.spec.ts` の `settled()`）。待たないと半透明の途中が写る
- **dev サーバーを付けっぱなしでスキーマを変えると、古い列のまま動いて 500 になる**（drizzle の `escapeName` で落ちる）。`pnpm db:migrate` のあとは dev サーバーを入れ直す
- `bb-link` を使うときは `no-underline` を付けない（下線は `bb-link` が引く）。選手側に `loading.tsx` は置けない（403・404 が 200 になる・ADR 0029）
- `processMailQueue` を呼ぶ DB テストは `mail.test.ts` だけ（送信待ちを取り合うため）。`purgeFromTrash` を呼ぶテストは後始末で `deletion_logs` を先に消す
- `0011` の列を指定した `ON DELETE SET NULL` 3 か所は手で直した（drizzle は出せない・ADR 0019）。`0016` は drizzle の出力から `0014` で手で足した分を除いた。作り直すときも同じ
- 一時保存は画面を移る直前に `saveNow`。drizzle のエラー文は引数（宛先など）を含むので `sanitizeError()` か `cause.code` だけを出す。`"use client"` の部品から `node:` を使うモジュール（`publish.ts` など）を import しない
- コンテナを作り直したら `bash .devcontainer/post-create.sh`。`pkill -f` の検索語が自分のコマンドに含まれないよう変数で組み立てる
