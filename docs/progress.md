# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: A-29 1a の仕上げ（Phase 1a の実装が一巡した）
- 次のタスク: B-01 大会・申込・会員のテーブル
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
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
