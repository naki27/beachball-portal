# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: B-10 申込③: 確認・送信・完了
- 次のタスク: B-11 前回コピー
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### B-08〜B-10（2026-09-20）
- やったこと:
  - B-08: ビュー `player_suggestions`（付録 A）と `src/lib/search/`（`MemberSearch` と Postgres の実装・付録 C の SQL）。`POST /api/[スラッグ]/members/suggest`（`{q, members_only, year}`）と `…/members/same-name`（氏名の完全一致・最大 3 件）。**候補は代表者を務める有効なチームの現役の選手だけ**。正規化後 2 文字未満は 0 件、60 回/分/ユーザー。`TeamError` に 429、`date.ts` に `fiscalYear`
  - B-09: 選手枠（`src/lib/entries/player-slots.ts` と `src/components/entries/player-slot.tsx`）。申し込むチームのプルダウン＋名前で探すサジェスト（200ms）、「協会員だけを表示」（その年度のデータがなければ出さない）、手入力（同意の文言）、「この方ですか？」、二重選択の防止、混合の部の男女の人数。`getEntryFormData` に `rosters`・`teamSizeMin/Max`・`year`・`showMembersOnly`・部の設定値。`src/lib/repo/memberships.ts`
  - B-10: 確認ページ（`…/entry/confirm`・一時保存から読む）、`POST /api/[スラッグ]/tournaments/[id]/entries`（1 トランザクションでチーム作成・名寄せ・選手一覧への自動追加・`entries`/`entry_players`・`entry_count`・メール）、完了ページ `/[スラッグ]/entries/[id]`、`entry_completed` の雛形。`entries.submit_token` の一意制約で二重送信を止める。ADR 0024
- 動作確認: lint / typecheck / test（TZ 2 回・593 本。`tests/db/member-suggest`・`entry-submit`・`entry-form`、`tests/unit/player-slots`・`date`・`forbidden-who`）、E2E は全 72 本（WebKit と Chromium）
- 次への申し送り・既知の課題:
  - **`/[スラッグ]/entries/[id]` は今は読むだけ**。変更・取消のボタンは B-12 でこのページに足す（完了メールのリンク先も同じ）
  - 申込の**警告は送信の応答（`warnings`）に入れているが、画面にはまだ出していない**。§5.5 の「1 件目の代表者にも確認ページで同じ警告」も B-12 以降
  - `entry_players` は申込時点のスナップショット。脱退・削除された選手の印（§5.5）は B-12
  - 前回コピー（B-11）のための `entries/latest` はまだない
  - 一時保存は確認ページへ進む直前に `saveNow` で書く（移動で消えるため）。画面を足すときは同じ扱いに
  - 大会・申込の論理削除と `TRASH_TABLES` は B-17。公開の応答に選手の情報を入れない決まりは `src/lib/public/tournaments.ts` の型と `tests/db/public-tournaments.test.ts` で守っている
  - 画面を先に触ると React の初期化で入力が戻るため、E2E は `[data-hydrated]` を待ってから操作する
- 使った枠（/usage の変化）: 未計測
