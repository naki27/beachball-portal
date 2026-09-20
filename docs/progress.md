# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-26 削除済みデータと物理削除
- 次のタスク: A-27 日次ジョブ（1a の分）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### A-26（2026-09-20）
- やったこと: `/[スラッグ]/admin/trash`（種類で絞り込み・件数・復元・完全に削除（2 段階の確認＋理由））。表ごとの扱いは `src/lib/admin/trash.ts` の `TRASH_TABLES` の 1 か所（`teams`・`team_members`・`members`・`contact_messages`。1b・1c はここに足す）。物理削除は論理削除済みだけ（そうでなければ 409）・1 トランザクション・子は外部キーの cascade に任せ、`deletion_logs` に表名・ID・一緒に消えた件数・理由・実行者だけを残す。親が削除済みのままの子は復元させない（409）。論理削除の入口を足した: 問い合わせ（`/admin/contacts` の「削除する」）と人物（`/admin/members/[id]` の「この登録を削除する」）。`0010`: `contact_messages` に `app_user` の delete 権限。API: `GET /api/[スラッグ]/admin/trash?table=`・`POST …/trash/[table]/[id]/restore`・`DELETE …/trash/[table]/[id]`・`DELETE …/admin/members/[memberId]`・`DELETE …/admin/contacts/[id]`。ADR 0018
- 動作確認: lint / typecheck / test（TZ 2 回・292 本。代表者は 403・論理削除していないものは 409・理由なしは 400・`deletion_logs` に氏名が入らない・復元で選手一覧の行まで元どおり・同じ氏名と生年月日で登録し直せる）、E2E 32 本 ×2 ブラウザ（削除 → 削除済みデータ → 復元 → もう一度削除して完全に削除）
- 次への申し送り・既知の課題:
  - 申込に出ている人物・申込が残っているチームは 409 で断っている。`entry_players` の書き換え（保存期間／本人の依頼の作り分け）は B-17、`countOpenEntries` は B-01 まで 0
  - 人物の統合（まとめ先）がある人物は消せない。統合そのものは B-15
  - `/admin/trash` は 1 ページに全部出す（件数が増えたら絞り込みか読み込みの追加を考える）
- 使った枠（/usage の変化）: 未計測

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
