# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: B-07 申込①: 入力ページの骨組み（チームと部）
- 次のタスク: B-08 サジェストと「この方ですか？」の API
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### B-05〜B-07（2026-09-20）
- やったこと:
  - B-05: 大会の部の管理（`/[スラッグ]/admin/tournaments/[id]` の下半分）。「よく使う部」（`category_presets`）からチェックで一括追加（混合 / MIX を選べる・同じ部は飛ばす）、部ごとの表示名・締切・基準日・上限の上書き、申込のある部は 409 で削除不可。基準日を変えたときの警告一覧と「新しい基準日で確定する」（`entry_audits` に `recalc_age`。履歴には位置と年齢だけ）。大会の編集に「部ごとの締切も大会に揃える」（上書きを NULL に戻す）。テナント設定 `/[スラッグ]/admin/association` で「よく使う部」の追加・編集・削除（記号は不変・使用中は 409）。ADR 0022
  - B-06: 公開ページ（協会トップの受付中／今後、`/[スラッグ]/tournaments`、大会詳細、参加チーム一覧）と公開 API 3 本。`draft` は 404。権限表に `publicTenant` を足した。`deadline.ts` に `tournamentEntryState`・`daysUntilDeadline`、`date.ts` に `diffDays`、部の条件の文章は `src/lib/tournaments/category-text.ts`、締切の文言は `deadline-text.ts`。`pnpm db:seed:dev` に大会 2 つ（受付中・締切後）
  - B-07: `/[スラッグ]/tournaments/[id]/entry`（ログインした人なら開ける・未ログインは 403・締切後と受付前は 409 の画面／管理者は開ける）。チーム（代表者を務めるチームだけ・個人登録と無効なチームは出さない・なければその場で名前を入れる）、「チーム名（公開されます）」、出場する部（条件の文章・締切を過ぎた部は選べない）、備考、「入力 → 確認 → 完了」、一時保存（A-06 の `useDraft`）、送信用のワンタイムの値の発行。ADR 0023
- 動作確認: lint / typecheck / test（TZ 2 回・542 本。`tests/db/tournament-categories.test.ts`・`public-tournaments.test.ts`・`entry-form.test.ts`、`tests/unit/category-input`・`preset-input`・`category-text`・`deadline-text`・`entry-input`）、E2E は `admin-tournaments` / `public-tournaments` / `entry-form` を WebKit と Chromium の両方。`pnpm db:seed:dev` も流した
- 次への申し送り・既知の課題:
  - **送信用のワンタイムの値は発行するだけで、まだ消費していない**（B-10 で表と一緒に決める）。「確認へ」は入力の検査までで、確認ページは B-09・B-10 のあと
  - 参加チーム一覧・大会詳細の公開の応答に選手の情報を入れない決まりは、`src/lib/public/tournaments.ts` の型と `tests/db/public-tournaments.test.ts`（応答を丸ごと文字列にして確かめる）で守っている。ここに列を足すときは注意
  - `countOpenEntries`（`src/lib/repo/entries.ts`）はまだ 0 のまま（B-09/B-10）。申込上限の判定も未実装（`max_entries` は保存だけ）
  - 大会・申込の論理削除と `TRASH_TABLES` は B-17。部の削除は論理削除だが、削除済みデータの画面にはまだ出ない
  - 画面を先に触ると React の初期化で入力が戻るため、E2E は `[data-hydrated]` を待ってから操作する
- 使った枠（/usage の変化）: 未計測

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
