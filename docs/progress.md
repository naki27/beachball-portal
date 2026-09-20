# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-22 問い合わせフォーム
- 次のタスク: A-23 プライバシーポリシー・利用規約のページ
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### A-22（2026-09-20）
- やったこと: `/[スラッグ]/contact`（その協会宛て。`?entryId=` は B-01 用に受けるだけ）と `/contact`（宛先を選ぶ。協会は役割を持つ協会、なければ全協会）。ログイン済みなら氏名・メールを補完。honeypot と 5 件/時（IP・メール）。受付控えと転送（協会の `contact_email`、未設定なら `CONTACT_TO`）を同じトランザクションで積む。雛形は受付番号から本文を読む（`params` は `messageId` と `scope` だけ）。`/[スラッグ]/admin/contacts`・`/platform/contacts`（未対応が既定・すべて・対応済み／未対応に戻す）。フッタと `/login/help` から問い合わせへ（協会の画面ならその協会宛て）。種別と画面の言い方は `src/lib/contact-subjects.ts` の 1 か所。API: `POST /api/contact`・`POST /api/site-contact`・`PATCH /api/[スラッグ]/admin/contacts`・`PATCH /api/platform/contacts`。ADR 0016
- 動作確認: lint / typecheck / test（TZ 2 回・271 本。控えと転送の 2 通・params に本文を入れない・honeypot・6 件目は 429・ほかの協会の分は見えない／変えられない・削除済みは出ない）、E2E 58 本（フッタ → ログインせずに送る → job:mail → Mailpit に控えと転送 → 管理者が一覧で対応済みに）
- 次への申し送り・既知の課題:
  - 大会・申込の自動入力（`tournament_id`・申込番号）は B-01 以降。いまは `entry_id` を受けるだけで外部キーはない
  - 問い合わせの削除（論理削除の実行と復元）は A-26。一覧は `deleted_at` を既定で除いている
  - 試験で `processMailQueue` を呼ぶのは `mail.test.ts` だけにした（送信待ちを全部さらうので、2 つの試験が同時に流れると取り合って落ちる。`admin-invitations.test.ts` は `composeMail` と `mail_logs` の確認に変えた。別コミット）
- 使った枠（/usage の変化）: 未計測

### A-21（2026-09-18）
- やったこと: `/[slug]/admin` に「チーム管理」「メンバー管理」。`/admin/teams`（一覧・名前で検索・件数）、`/admin/teams/[id]`（代表者の付け替え（既存のアカウントを承諾なしで追加・解除）・チームの状態・チーム情報の編集・削除（論理。返事待ちの招待を取り消す））、`/admin/members`（氏名・ふりがなの正規化後の部分一致。空なら最新 100 件で要確認を先に）、`/admin/members/[id]`（載っている選手一覧と誤登録の行の削除・アカウントとの紐づけの解除・登録情報の修正）。`src/lib/admin/{access,teams,members}.ts`。API: `DELETE /api/[slug]/admin/teams/[id]`、`POST …/admin/teams/[id]/admins`、`DELETE …/admin/teams/[id]/members/[tmId]`、`PATCH …/admin/members/[id]`（編集・無効化は代表者と同じ `PATCH /api/[slug]/teams/[id]`）。ADR 0015
- 動作確認: lint / typecheck / test（TZ 2 回・260 本。代表者は 403・付け替え・削除で招待が取り消される・行の削除で人物は残る）、E2E 54 本（テナント管理者がチームを探して代表者を付け替え → メンバーを探して誤登録の行を消す）
- 次への申し送り・既知の課題:
  - 要確認の解消と 2 つの人物をまとめる画面は B-15（`/admin/members` には「確認が必要」の印だけ）。削除済みデータの復元は A-26
  - `countOpenEntries`（`src/lib/repo/entries.ts`）は B-01 まで常に 0。無効化・削除の 409 はその後に効く
  - チームの一覧の検索は原文の部分一致（大文字小文字は無視）。人物の検索は正規化後（`normalize.ts`）
- 使った枠（/usage の変化）: 未計測

### A-20（2026-09-18）
- やったこと: `/[slug]/teams/[id]/admins`（いまの代表者（表示名・メール）・外す／代表者を降りる（最後の 1 人は不可）・返事待ちの代表者の招待（もう一度送る・取り消す）・追加（選手一覧の紐づいた人から選ぶ／メールアドレス。承諾で代表者））。`src/lib/teams/admins.ts`（`inviteAdmin`・`revokeTeamAdmin`・`getTeamAdmins`）、`setTeamStatus`（無効化・有効に戻す。代表者は締切前の申込が残っていれば 409 → `src/lib/repo/entries.ts` の `countOpenEntries` は B-01 まで常に 0。無効化で返事待ちの招待をすべて取り消す。個人登録は不可）。チームのページに「代表者」リンクと「チームの状態」（確認つき）。API: `POST …/invitations { kind: "admin", email | memberId }`、`DELETE …/teams/[id]/admins/[userId]`、`PATCH …/teams/[id] { status }`。ADR 0014
- 動作確認: lint / typecheck / test（TZ 2 回・255 本。最後の代表者は降りられない・無効化で招待が取り消される・無効なチームでは招待できない）、E2E 52 本（代表者を招待 → 別ブラウザで承諾 → 元の代表者が降りる → 残った代表者は降りられない → 無効にする → 有効に戻す）
- 次への申し送り・既知の課題:
  - チームの削除（論理）はテナント管理者だけ（A-21）。`countOpenEntries` を B-01 で本物にする（`setTeamStatus` と削除の両方が使う）
  - 代表者のメールアドレスは代表者どうしにだけ見える（ADR 0014）
- 使った枠（/usage の変化）: 未計測

### A-19（2026-09-18）
- やったこと: 選手の招待（3 日・同じチームからは同じ行を再送・別のチームからの返事待ちがあれば 409・紐づいた人は 409・無効なチームは 409）、再送、取り消し。`0007`: `my_pending_invitations()` に `team_id`・`member_name`。`/invitations` で選手・代表者の招待に「参加する／心当たりがない」（`respondToInvitation` が種別で振り分け）。承諾の再検査（期限・アドレス・人物・チーム・1 アカウント 1 人物 → 招待の人物を要確認にして 409、招待は返事待ちのまま）。承諾・拒否・期限切れの知らせは招待した代表者（いなければ有効な代表者全員）。雛形 `team_invitation`・`_accepted`・`_rejected`・`_expired`。紐づけの解除（本人・テナント管理者。個人登録がある間は本人からは不可）とマイページの「選手として所属するチーム」「アカウントとの結びつきを解除する」。選手一覧に「招待する（メール入力）／招待中（期限）＋もう一度送る・取り消す／本人がログインできます」。ADR 0013
- 動作確認: lint / typecheck / test（TZ 2 回・249 本。§5.15: 承諾で `members.user_id`・別のアドレスでは 404・期限切れ 409・別の人物に紐づいたアカウントは要確認・解除は本人と管理者だけ）、E2E 50 本（招待 → job:mail → Mailpit の本文 → 別ブラウザで本人がログイン → 参加 → 自分の生年月日は見え、ほかの人のは見えない）
- 次への申し送り・既知の課題:
  - 代表者としての招待（`kind = admin`）の承諾は `team-respond.ts` に実装済み（`team_admins` に `granted_by` 付き）。A-20 は招待を作る側と解除・無効化
  - 期限切れの検出（`expired` にして `team_invitation_expired` を送る）は日次ジョブ（A-27）
  - API: `POST/DELETE …/teams/[id]/invitations[/[invId]]`、`POST …/invitations/[invId]/resend`、`DELETE /api/[slug]/members/[memberId]/link`
  - bash のヒアドキュメントに長い Python を渡すと解釈に失敗することがある。長い編集はスクラッチパッドにスクリプトを書いて実行する
- 使った枠（/usage の変化）: 未計測
