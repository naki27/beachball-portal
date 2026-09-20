# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: B-18 1b の仕上げ（**Phase 1b は完了**）
- 次のタスク: C-01 大会資料のアップロードと保管（1c）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### B-11〜B-18（2026-09-20）
- やったこと:
  - B-11: 前回コピー。`GET /api/[スラッグ]/teams/[id]/entries/latest`（選手と部の `code` だけ。生年月日は返さない）、入力ページの「前回と同じ選手にする」、`src/lib/entries/copy-previous.ts`（枠の復元・外した人の理由・`code` での部の対応づけ）。取り消した申込からも戻す（ADR 0025）
  - B-12: 申込の変更・取消。`PATCH / DELETE /api/[スラッグ]/entries/[id]`、`/entries/[id]/edit`、詳細ページの取消（元に戻せない旨の確認）。締切後は代表者 409・管理者は可で `entry_audits`（生年月日なし）。`entry_updated` / `entry_cancelled` のメール。選手一覧からいなくなった人の印と、同じ大会の別の申込の警告（先に申し込んだ側にも）
  - B-13: 管理者の申込一覧（`/admin/tournaments/[id]/entries`）と CSV（`src/lib/export/csv.ts`・1 選手 1 行・BOM・生年月日はチェック時だけ・`export_logs`）、「確認済みにする」、`date.ts` の `formatDateTimeTokyo`
  - B-14: `StorageAdapter`（`local` / `r2`。R2 は SigV4 を自前で付ける。**本物の R2 では未確認**＝ X-01）、バックアップの暗号化（X25519＋AES-256-GCM の公開鍵方式）、日次ジョブ ②（締切後の申込一覧 CSV を開催日の翌日まで毎日）
  - B-15: 要確認の解消と人物の統合（`/admin/members` の「確認が必要」→ 比較 →「別の人です」／「まとめる」）。1 トランザクションで付け替え、両方が別アカウントに紐づいていたら 409、`admin_access_logs`
  - B-16: マイページの申込（代表者として操作できる分・選手として出る分）とトップの「あなたのやること」
  - B-17: `/admin/trash` に大会・部・申込。大会と誤登録の申込の論理削除の API。人物の物理削除での申込の記録の扱い（保存期間＝生年月日だけ消す／本人の依頼・誤登録＝氏名も「（削除済み）」）、`entry_audits` の氏名の置き換え（マイグレーション 0015 の列を指定した GRANT）
  - B-18: 1b の仕上げ。E2E `tests/e2e/entry-manage.spec.ts`（マイページ → 変更 → 管理者の一覧と CSV → 取消 → 前回コピー）、権限表のテストに 1b の行（`viewOwnTeamEntries` / `manageEntries` / `manageTournaments`）、README と `docs/ops.md`（大会と申込の運用・試験運用の手順）
- 動作確認: lint / typecheck / test（TZ 2 回・669 本）、E2E は 74 本すべて（WebKit 375×667 と Chromium 360×640。メモリの都合で 3 回に分けて流した）
- 次への申し送り・既知の課題:
  - **管理者が定員を超えて登録するときの「定員を超えています」の確認は未実装**（申込ページには入れていない。管理画面の申込一覧に説明文だけ置いた）
  - 協会員区分は「協会員／非会員」だけ（`memberships` の年度データがなければ空欄）。「更新の受付中（昨年度は協会員）」などは D-05
  - R2 の実装（`src/lib/storage/r2.ts`）は**本物の R2 につないで確かめていない**。X-01 で確かめる。バックアップの鍵はローカルだと `.local-storage/backup-test-key.json`
  - E2E は全部いちどに流すと dev サーバーが落ちる（コンテナのメモリ）。ファイルを分けて流す
  - `docs/p0-tasks.md` の C は B-14 のストレージの土台の上に載る（`StorageAdapter` の `private` / `public` はまだ使っていない）
- 使った枠（/usage の変化）: 未計測
