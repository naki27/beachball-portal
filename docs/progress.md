# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: 利用者の操作ログ（設計書外の追加。**Phase 1a・1b・1c・1d は完了**。残りは X-01〜X-05 のデプロイ）
- 次のタスク: X-01 本番用の設定（Phase 0 の人の作業（GCP・Neon・Cloudflare・Brevo）が終わってから）
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### 利用者の操作ログ（2026-09-21）
- やったこと: `src/proxy.ts` から `src/lib/access-log` を呼び、リクエストを 1 行 1 件（JSON Lines）で記録。時刻（日本時間）・メソッド・パス・クエリ（`q`・`name`・`code` などは値を `***`）・協会スラッグ・Server Action の id・セッションのハッシュ（`sessions.session_hash` と同じ）・IP・User-Agent。応答のステータスは残さない（proxy からは見えない）。`ACCESS_LOG_DRIVER`（`file` 既定 / `stdout` / `off`）で切り替え、file は月替わりか 100 MB で退避して 6 世代（半年）残す。ADR 0027・`docs/ops.md`「操作ログ」・`.env.example`
- 動作確認: lint / typecheck / test（TZ 2 回・813 本）・`pnpm build`。dev サーバーに curl して `logs/access.log` に出ること、`q` が伏せ字になること、`/api/health` が記録されないこと、セッションのハッシュが `sha256` と一致することを確かめた
- 次への申し送り: **X-01 で本番の環境変数に `ACCESS_LOG_DRIVER=stdout` を入れ、Cloud Logging の保存期間を 180 日にする**（Cloud Run はファイルが消えるのでファイル方式は使えない）
### C-01〜C-03・D-01〜D-05（2026-09-20）
- やったこと:
  - C-01: 大会資料の表と RLS（マイグレーション 0016・0017）。アプリ経由のアップロード（10 MB 以下・Content-Type・先頭の `%PDF-` を検証。拡張子だけ `.pdf` の画像は通らない）、保管用（private）に保存、管理画面の一覧（種別・タイトル・公開／非公開・並び順・個人情報の注意書き）
  - C-02: 公開中の資料だけを公開用バケットへ（ランダムな名前・`Content-Disposition`・キャッシュ 1 時間）。非公開・削除・大会を draft に戻す・大会の削除で公開用から消し、復元で戻す。差し替えは新しい名前。`/[スラッグ]/tournaments/[id]/documents/[docId]` → 302（開けない資料は 404）。ローカルは `/dev-files/…`。日次ジョブ ⑥ 迷子のファイルの後始末
  - C-03: E2E（アップロード → 未ログインで開く → 非公開で 404）、トップの「新しい資料」、物理削除時のファイル削除、ADR 0026（配信方法は `PUBLIC_FILES_BASE_URL` 1 か所。実際の選択は X-05）
  - D-01: `src/lib/membership.ts`（付録 F）。**年度を渡さずに呼べない**形。`isMember` / `decideMembershipDisplay` / `membershipDisplays` / `renewalState` / 画面と CSV の文言
  - D-02: `/admin/memberships` で受付開始（対象年度・受付期間・承認を省くか）。対象チームの代表者のトップとチームの画面に案内
  - D-03: `/teams/[id]/membership` の申告（昨年度の会員に初期チェック・「12人中10人を…」・締切前の送り直しで変えていない人はそのまま）、申告の控えのメール
  - D-04: 未申告の一覧・まとめて承認・承認のメール・追加の申告（締切後〜年度末・増やすだけ・承認を省く年度でも承認待ち）・運営の代理の申告
  - D-05: 申込一覧・CSV の協会員区分（開催日の年度・「更新の受付中（昨年度は協会員）」・データのない年度は空欄）、チーム管理の今年度の状態、権限表のテストに 1d の行、申告の E2E
- 動作確認: lint / typecheck / test（TZ 2 回・791 本）、E2E は 1c・1d の新しい 2 本を WebKit 375×667 と Chromium 360×640 で、影響のある既存の 15 本を WebKit で流した（ファイルを分けて）
- 次への申し送り・既知の課題:
  - **大会資料の配信方法（§5.9 の第 1〜3 案）は未決定**。`PUBLIC_FILES_BASE_URL` の値だけで切り替わる形にした（ADR 0026）。X-05 で決める
  - R2 のアダプタは**本物の R2 につないで確かめていない**（X-01）。`Content-Disposition` / `Cache-Control` を PUT で付けるようにしたので、そこも一緒に確かめる
  - 依頼メールの一斉送信・督促（P1）、前年度の名簿の取り込み（P1）、名簿の各形式の出力（P1）は未実装。初年度は初期チェックなしで全チームが選ぶことになる
  - 「追加の申告」で会員を**外す**のは運営の代理だけ（§5.12【仮】のまま）
  - 管理者が定員を超えて登録するときの確認は未実装（1b からの持ち越し）
  - E2E は全部いちどに流すと dev サーバーが落ちる（コンテナのメモリ）。ファイルを分けて流す
- 使った枠（/usage の変化）: 未計測
