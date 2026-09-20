# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-25 アカウントの削除
- 次のタスク: A-26 削除済みデータと物理削除
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### A-23〜A-25（2026-09-20）
- やったこと:
  - A-23: `/privacy`・`/terms`（未ログインで開ける）。文面は `docs/legal/privacy.md`・`terms.md`（`templates.md` から起こした下書き。公開前に専門家の確認）。表示は `src/lib/legal/markdown.ts` の小さなマークダウンの解釈（見出し・段落・箇条書き・表・強調・リンク。HTML コメントは出さない）。サイト名は `{{SITE_NAME}}` を置き換え。版は文面の「版: …」＝ `.env` の `TERMS_VERSION`
  - A-24: `/mypage/email`（新しいアドレスに番号 → 確定 → 古いアドレスに `email_changed`。使われているアドレスなら 409・ほかの端末のセッションを終了・返事待ちの招待があれば先に返事をするよう案内）。API: `POST /api/me/email/request` / `verify`
  - A-25: `/mypage/delete`（代表者・協会の管理者・運営管理者は理由と次の手順を出して削除させない。いまのアドレスに番号 → `DELETE /api/me`）。`0009`: `my_account_deletion_block()` と `delete_my_account(new_email)`（協会をまたぐので SECURITY DEFINER）。メールアドレスを `deleted-…@deleted.invalid` に置き換え・表示名を消す・人物の紐づけを外す・返事待ちの招待を取り消す・全セッション終了
  - 確認番号の照合を `src/lib/auth/match-code.ts` に 1 つだけ置き、ログインとメールアドレスの変更が同じ規則を使う。ADR 0016（A-22）・0017
- 動作確認: lint / typecheck / test（TZ 2 回・285 本）、E2E は spec ごと・数本ずつで全部通る（フッタ →/privacy・/terms／メールアドレスの変更 → Mailpit に新旧 2 通 → 新しいアドレスでログイン／代表者は削除できない → 降りれば削除でき同じアドレスで作り直せる）、`pnpm build`
- 次への申し送り・既知の課題:
  - 文面の【要確認】（専門家に見てもらう点）は `docs/legal/*.md` の末尾にコメントで残してある。公開の前に埋める
  - 規約の改定で同意を取り直すかは P1（`users.terms_version` と `TERMS_VERSION` を比べれば判定できる）
  - `app_definer` に書き込みの権限を足したのは `delete_my_account` のためだけ（0009）。A-26 の物理削除も同じ形で足す
  - 削除したアカウントの `mail_logs`・問い合わせに残るアドレスは保存期間が過ぎるまで残る（画面にもそう書いた）
  - **`pnpm test:e2e` を全部いちどに流すと、21 本あたりで dev サーバーが落ちる**（`roster` や `team-admins` の途中で「Connection refused」）。A-23〜A-25 を外した状態でも同じなので、このコンテナのメモリ不足（`free -m` で swap を使い切っていた）。当面は `--project` かファイルを分けて流す。改善するなら `next.config.ts` の `onDemandEntries`（1 時間・100 ページ保持）を見直すか、コンテナのメモリを増やす
- 使った枠（/usage の変化）: 未計測

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
