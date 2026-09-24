# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: B-18 1b の仕上げ（**Phase 1a・1b は完了**）。2026-09-24 に L-02〜B-18 の申し送りを全部コードと突き合わせ、解消済みを消して残りを下にまとめた（各タスクの「やったこと」は docs/progress-archive.md）
- 次のタスク: C-01 大会資料のアップロードと保管（1c）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 残っている申し送り（2026-09-24 に見直し）
### あとのタスクで片づくもの
- `StorageAdapter` の `private` / `public` はまだ使っていない（`backup` だけ）。C-01 から使う
- 協会員区分は「協会員／非会員」だけ（`memberships` の年度データがなければ空欄）。「更新の受付中」などは D-05

### 本番の前に（X 系・運用）
- R2（`src/lib/storage/r2.ts`）は**本物の R2 で未確認**。§11.2 の送信数 8 割の警告も未実装 → X-01。バックアップの鍵はローカルだと `.local-storage/backup-test-key.json`
- 日次ジョブの ① DB バックアップ・⑥ R2 の後始末・⑦ 最小インスタンス数は未実装（`src/lib/jobs/daily.ts` の先頭に注記）
- 保存期間: `RETENTION_DAYS`（`daily.ts`）に `entry_audits`・`export_logs` がない。足すときは `app_job` に delete の GRANT が要る（`0012` は select・insert だけ）
- E2E は CI に入れていない（L-05・A-29 で先送りしたまま。入れるか決める）
- 運営画面に「アクセス記録」（`admin_access_logs`）と `mail_logs` を読む画面がない（§5.14。RLS 外の表なので読むには SECURITY DEFINER が要る）
- 法務の【要確認】（`docs/legal/*.md` の末尾）・らくらくスマートフォンの実機・`docs/ops.md` §8 の未決事項

### 小さな未実装・気になる点（どのタスクにも割り当てていない）
- 申込ページで管理者が定員を超えるときの「定員を超えています」の確認は未実装（サーバーは管理者なら通す・`submit-entry.ts`。管理画面の申込一覧に説明文だけ）
- 問い合わせは `?entryId=` を `contact_messages.entry_id` に入れるだけ。`tournament_id` は入れず、申込の画面から `?entryId=` 付きで飛ぶ導線もない（変更画面の 409 は `/contact` だけ）
- 個人登録だけの人にも `/`・マイページで「チームの代表者」と出る（`ROLE_LABEL`。`getMembership` がチームの種類を持たない）
- `/admin/trash` は全件を 1 ページに出す（件数が増えたら絞り込みか読み込みの追加）
- `db:studio` は app_owner でつなぐのでテナント表が 0 件に見える（中身は `postgres` でつなぐ）
- ADR 0007 の表示名 30 文字は §14-13 と突き合わせていない
- 規約の改定で同意を取り直す（`users.terms_version` と `TERMS_VERSION` の比較）は P1

### 作業の注意（消さない）
- E2E: 全部いちどに流すと dev サーバーが落ちる（コンテナのメモリ）→ ファイルか `--project` で分ける。`tests/e2e/fixtures.ts` の `test` を使う。`[data-hydrated]` を待ってから押す。login などの補助関数は spec ごとに写している（共通化は未着手）
- `processMailQueue` を呼ぶ DB テストは `mail.test.ts` だけ（送信待ちを取り合うため）
- `0011` の列を指定した `ON DELETE SET NULL` 3 か所（`entry_players.member_id`・`memberships.team_id`・`contact_messages.entry_id`）は手で直した（drizzle は出せない・ADR 0019）。作り直すときも同じ
- 一時保存は画面を移る直前に `saveNow`。drizzle のエラー文は引数（宛先など）を含むので `sanitizeError()` か `cause.code` だけを出す
- コンテナを作り直したら `bash .devcontainer/post-create.sh`。dev サーバーが重くなったら `pnpm dev:poll` を立て直す
- キャリアの受信設定の URL（`help-form.tsx`）は人が確かめる
- 使った枠（/usage の変化）: 未計測
