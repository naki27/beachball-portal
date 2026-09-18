# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-19 選手の招待（A-12 は人の確認待ち）
- 次のタスク: A-20 代表者の委譲・解除とチームの無効化
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### A-19（2026-09-18）
- やったこと: 選手の招待（3 日・同じチームからは同じ行を再送・別のチームからの返事待ちがあれば 409・紐づいた人は 409・無効なチームは 409）、再送、取り消し。`0007`: `my_pending_invitations()` に `team_id`・`member_name`。`/invitations` で選手・代表者の招待に「参加する／心当たりがない」（`respondToInvitation` が種別で振り分け）。承諾の再検査（期限・アドレス・人物・チーム・1 アカウント 1 人物 → 招待の人物を要確認にして 409、招待は返事待ちのまま）。承諾・拒否・期限切れの知らせは招待した代表者（いなければ有効な代表者全員）。雛形 `team_invitation`・`_accepted`・`_rejected`・`_expired`。紐づけの解除（本人・テナント管理者。個人登録がある間は本人からは不可）とマイページの「選手として所属するチーム」「アカウントとの結びつきを解除する」。選手一覧に「招待する（メール入力）／招待中（期限）＋もう一度送る・取り消す／本人がログインできます」。ADR 0013
- 動作確認: lint / typecheck / test（TZ 2 回・249 本。§5.15: 承諾で `members.user_id`・別のアドレスでは 404・期限切れ 409・別の人物に紐づいたアカウントは要確認・解除は本人と管理者だけ）、E2E 50 本（招待 → job:mail → Mailpit の本文 → 別ブラウザで本人がログイン → 参加 → 自分の生年月日は見え、ほかの人のは見えない）
- 次への申し送り・既知の課題:
  - 代表者としての招待（`kind = admin`）の承諾は `team-respond.ts` に実装済み（`team_admins` に `granted_by` 付き）。A-20 は招待を作る側と解除・無効化
  - 期限切れの検出（`expired` にして `team_invitation_expired` を送る）は日次ジョブ（A-27）
  - API: `POST/DELETE …/teams/[id]/invitations[/[invId]]`、`POST …/invitations/[invId]/resend`、`DELETE /api/[slug]/members/[memberId]/link`
  - bash のヒアドキュメントに長い Python を渡すと解釈に失敗することがある。長い編集はスクラッチパッドにスクリプトを書いて実行する
- 使った枠（/usage の変化）: 未計測

### A-18（2026-09-18）
- やったこと: `/[slug]/teams/new` に「チームで登録／個人で登録」の切り替え（`?kind=individual`）。個人で登録は本人の情報だけ・`kind = individual`・名前は本人の氏名・常に協会員の登録をする・1 協会 1 つ（409）・自分のアカウントに紐づけ、すでに紐づいた人物があれば確認だけ（`SelfConfirm`）。チームのページは個人登録なら「あなたの登録情報」（タブは「登録情報」）。選手の追加に「自分を選手として登録する」（`?self=1`。紐づいた人物があれば確認だけ）。マイページの枠に「あなたの登録情報」と「個人で登録する」。`src/lib/teams/self.ts`（`registerIndividual`・`registerSelfAsPlayer`・`getMyPerson`）、`PlayerForm` は送り先を `submit` で受ける形に。API: `POST /api/[slug]/teams { kind: "individual" }`、`POST …/members { self: true }`。ADR 0012
- 動作確認: lint / typecheck / test（TZ 2 回・239 本。1 協会で個人登録は 1 つまで・1 アカウント = 1 人物・同じ人物がほかの人に紐づいていれば新しい人物を要確認で）、E2E 48 本（個人で登録 → マイページ → 2 つ目は不可 → チームに自分を選手として（確認だけ））
- 次への申し送り・既知の課題:
  - **E2E は `tests/e2e/fixtures.ts` の `test` を使う**（`@playwright/test` の `test` は使わない）。テストごとにログインのレート制限の行を消す。ログインが 20 回を超えて「◯時まで送れません」で落ちていたため
  - 個人登録の連絡先の編集は P0 ではできない（ADR 0012）。`teams.name` は作成時の氏名のまま
  - `/` とマイページの役割の表示は、個人登録だけの人にも「チームの代表者」と出る（`getMembership` はチームの種類を持たない）。気になれば後で直す
- 使った枠（/usage の変化）: 未計測

### A-17（2026-09-18）
- やったこと: `/[slug]/teams/[id]/members`（1 人 = 1 カード。代表者には生年月日「1965年（昭和40年）5月3日」・年齢・性別と「修正する」「選手一覧から外す」、本人が 30 分以内に外した行に「◯◯さんを外しました［元に戻す］」。選手にはほかの人の生年月日・年齢・性別を返さない）、`…/members/new`（同意の文言・和暦の生年月日・保存時に名寄せ）、`…/members/[tmId]/edit`。`src/lib/teams/{roster,access,errors,player-input}.ts`（`authorizeTeam` = 404 → 403 の共通の入口。`editTeam` もこれを使う）、`src/lib/repo/team-members.ts`。API: `GET/POST …/members`、`PATCH …/members/[tmId]`、`POST …/leave|undo-leave`。ADR 0011
- 動作確認: lint / typecheck / test（TZ 2 回・231 本。§5.11 の受け入れ条件: 2 チームに同じ人でも `members` は 1 件・外しても `members` は残る・別の代表者は戻せない 403・30 分後は 409・代表者でない人は 403・別の協会は 404）、E2E 46 本（4 人追加 → 外す → 元に戻す → 別のチームに同じ人 → `members` は 1 件）
- 次への申し送り・既知の課題:
  - 個人登録（A-18）は `addPlayer` が `kind = individual` を 409 にしている。本人の登録は別の口（`registerIndividual`）で作る
  - `TeamError` は `src/lib/teams/errors.ts` に移した。画面では `pageErrorFrom(error)`（404 → notFound、403 → forbidden）
  - 選手一覧の追加では一時保存（`useDraft`）を使っていない（ADR 0011）
  - E2E は令和生まれ（15 歳未満）を入れると「合っていますか？」が出るので `confirmAge` で押す
- 使った枠（/usage の変化）: 未計測

### A-16（2026-09-18）
- やったこと: `src/components/ui/birth-date-field.tsx`（昭和・平成・令和・西暦のボタン（既定は昭和）、年・月・日の数字の欄、「（1965年）・61歳」、元号の範囲外はその場で誤り、15 歳未満か 80 歳以上は「◯歳で合っていますか？」［はい、合っています］。親には `{ date, ready }`）、`src/lib/wareki.ts`（`parseBirthDateParts`・`formatBirthDateLong`「1965年（昭和40年）5月3日」・`partsFromDate`）、`src/lib/age.ts`（`ageAt`。B-02 の規則とテストを先に入れた）。`/dev/ui` に部品と値の表示。ADR 0010
- 動作確認: lint / typecheck / test（TZ 2 回・218 本。元号の境界 4 つ・範囲外・年齢の確認の境目・2/29）、E2E 44 本（`/dev/ui` で昭和5年と平成5年を入れ比べ → 確認 → 昭和65年は誤り）
- 次への申し送り・既知の課題:
  - 使う画面は `ready` が true になるまで送信・次へを押させない。サーバー側でも生年月日の形・今日より前を確かめる（部品の検査だけにしない）
  - B-02 は `deadline.ts` だけでよい（`ageAt` はある）
  - 生年月日の一時保存（§4.3「通信」）は使う画面の `useDraft` で。部品は値を持つだけ
- 使った枠（/usage の変化）: 未計測
