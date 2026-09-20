# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: B-04 大会の管理（作成・編集・状態）
- 次のタスク: B-05 部門の管理と基準日の変更
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### B-02〜B-04（2026-09-20）
- やったこと:
  - B-02: `src/lib/deadline.ts`（`effectiveDeadline`・`effectiveAgeReferenceDate`・`entryState`・`isEntryOpen`）。締切と基準日は「部 → 大会」のフォールバック、受付の可否は状態と期間の両方で部ごとに判定。`ageAt`（`age.ts`）と日本時間の日付（`date.ts`）は A-04 の分をそのまま使った
  - B-03: `src/lib/eligibility.ts`（`validateEligibility`・`hasEligibilityError`）。数値はすべて部門プリセットの設定値から読む。性別と年齢の下限は選手を名指しする error（画面の枠に出せるよう `playerIndex` を返す）、混合は登録人数で編成が組めるかを見る、合計年齢は判定せず数字と注意文を出して `needsAdminCheck` を立てる。画面の文言は §4.4 に合わせて「部」。ADR 0020
  - B-04: `/[スラッグ]/admin/tournaments`（一覧・`new`・`[tournamentId]` の編集）。入力の検査は `src/lib/tournaments/tournament-input.ts` を画面と API で共用（日付は年月日だけ・開始は 0:00・締切は 23:59:59 で保存）。表をまたぐ整合性は `src/lib/admin/tournaments.ts` の `assertConsistentWithCategories` で 409。API: `POST /api/[スラッグ]/admin/tournaments`・`PATCH …/[tournamentId]`（`manageTournaments`）。リポジトリは `src/lib/repo/tournaments.ts`。管理トップに「大会の管理」を追加。状態の呼び名は `TOURNAMENT_STATUS_LABEL` の 1 か所。ADR 0021
- 動作確認: lint / typecheck / test（TZ 2 回・472 本。`tests/unit/deadline.test.ts`・`eligibility.test.ts`（§5.5(e) の受け入れ条件すべて）・`tournament-input.test.ts`・`tests/db/tournaments.test.ts`（代表者は 403・別協会は 404・400 の欄名・下限 < コート人数は 409・部の締切より後の開始は 409））、E2E は `tests/e2e/admin-tournaments.spec.ts` を WebKit と Chromium の両方、`admin-teams` / `top` / `platform` も通した
- 次への申し送り・既知の課題:
  - 大会の削除（論理）と削除済みデータは B-17。`TRASH_TABLES` に大会・申込はまだ入れていない
  - 部（`tournament_categories`）の追加・編集・基準日の変更後の再計算は B-05。編集画面に「出場する部の設定は準備中です」と出している
  - `countOpenEntries` はまだ 0（`deadline.ts` はそろったので B-09 以降で本物にできる）
  - 申込上限の判定（大会と部の両方・`for update` で 1 件ずつ）は B-09/B-10。`max_entries` は保存だけ
- 使った枠（/usage の変化）: 未計測

### B-01（2026-09-20）
- やったこと: 大会（`tournaments`・`tournament_categories`）・申込（`entries`・`entry_players`・`entry_audits`）・会員（`memberships`・`membership_periods`・`membership_declarations`）・`export_logs` を付録 A どおりに追加（`src/db/schema/tournaments.ts`・`entries.ts`・`memberships.ts`、`export_logs` は `logs.ts`）。`0011` が表・複合外部キー・CHECK、`0012` が RLS とロールの権限（0003 と同じ 5 文）。`mail_logs.entry_id`・`contact_messages` の大会（単一列）と申込（複合）の外部キーを足した。`platform_association_stats()` の受付中の大会を 0 固定から `status='open'` を数える形に差し替え。ADR 0019
- 動作確認: `pnpm db:migrate`（通る）、lint / typecheck / test（TZ 2 回・426 本）。新規 `tests/db/tournaments-schema.test.ts` 11 本: 別の協会の大会・プリセット・部門・チーム・人物を指す INSERT はすべて 23503、CHECK（人数の下限>上限・下限 0・申込上限 0・開始≧締切・status / sex / match_type / action / source の値）、部分一意（部門の code・1 人 1 年度）、列を指定した SET NULL の実際の動き、`association_id` を持つ表に RLS の付け忘れがないかの機械的な確認
- 次への申し送り・既知の課題:
  - **列を指定した `ON DELETE SET NULL` の 3 か所（`entry_players.member_id`・`memberships.team_id`・`contact_messages.entry_id`）は `0011` を手で直している**。drizzle は出せない（ADR 0019）。この 3 表を作り直すマイグレーションを書くときは同じ手直しが必要
  - `countOpenEntries`（`src/lib/repo/entries.ts`）はまだ 0 のまま。締切の判定が要るので B-02 のあとに本物にする（チームの無効化・削除の 409 がそれで効く）
  - `TRASH_TABLES`（`src/lib/admin/trash.ts`）に大会・申込は未追加（B-17）。`entry_audits`・`export_logs` の保存期間も未追加（足すときは `app_job` に delete の権限が必要。いまは select と insert だけ）
  - `entry_players.birth_date` が必須・部門がその大会のものであること・`team_size_min ≧ court_size` は DB では見ない（アプリで検査。B-04・B-09）
- 使った枠（/usage の変化）: 未計測

### A-27〜A-29（2026-09-20）
- やったこと:
  - A-27: `pnpm job:daily`（`src/lib/jobs/daily.ts`）。期限切れの確認番号・セッション・レート制限の物理削除、期限切れの招待を `expired` にして招待した人に知らせる（削除済みのアカウントには積まない）、保存期間を過ぎた記録（招待 1 年・`mail_logs` 1 年・`admin_access_logs` 3 年）の物理削除。保存期間は `RETENTION_DAYS` の 1 か所。協会に属する表は `withTenantOn` で協会ごと
  - A-28: API と §3.2 の行の対応を `src/lib/api/permissions.ts` に 1 か所でまとめ、そこからテストを作る。`tests/unit/api-permissions.test.ts`（route.ts の取りこぼし・メソッドの食い違い・入口の検査忘れ・URL に氏名やメールを載せない）と `tests/db/permissions.test.ts`（各ロールで実際に呼んで ○ は成功・× は 403、同じ人が X では代表者・Y では選手、協会 2 つで 404 / 403）。可否そのものは `src/lib/authz.ts` の `ACTIONS` が唯一のデータのまま
  - A-29: E2E `tests/e2e/acceptance-1a.spec.ts`（ログイン → チーム作成 → 選手 4 人 → 招待。文字 150%・200% のスクリーンショットを添付し、ボタンが画面幅に収まることを確かめる）、`pnpm db:seed:dev`（チーム 3・選手 20・招待 1。サービス層を通すので名寄せも本物と同じ。何度流しても増えない）、README に 1a の実装済み・未実装・既知の課題、`docs/ops.md`（協会の増やし方・本人確認・ログインの案内・日々の運用・ジョブ・未決事項）
- 動作確認: lint / typecheck / test（TZ 2 回・415 本）、E2E は acceptance-1a を WebKit と Chromium の両方で、roster / teams / admin-teams と合わせて通した。`pnpm db:seed:dev` → `pnpm job:daily` → `pnpm job:mail`
- 受け入れ条件（`docs/agent_prompt.md` A-6）の確認: すべて自動テストに対応づけた。足りなかったのは「同じ人が X の代表者かつ Y の選手」の明示テスト（A-28 で追加）と「URL に氏名・メールを載せない」の機械的な確認（A-28 で追加）。`pnpm test:e2e` の一括実行だけは下の既知の課題で通らない
- 次への申し送り・既知の課題:
  - **`pnpm test:e2e` を全部いちどに流すと 21 本あたりで dev サーバーが落ちる**（コンテナのメモリ不足。`--project` かファイルを分ければ通る）。直すならコンテナのメモリか `next.config.ts` の `onDemandEntries`
  - 日次ジョブの ①②⑥⑦（DB バックアップ・申込一覧 CSV・R2 の後始末・最小インスタンス数）は未実装。`entry_audits`・`export_logs` の保存期間は B-01 以降に `RETENTION_DAYS` へ足す
  - らくらくスマートフォンの実機は未確認（試用で見せてもらう）。プライバシーポリシー・利用規約の【要確認】は公開前に専門家へ
  - E2E のログイン・選手追加の補助関数は spec ごとに写している（共通化は未着手）
- 使った枠（/usage の変化）: 未計測
