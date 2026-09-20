# beachball-portal — ビーチボール大会申し込みサイト【仮】

ビーチボール大会の申込・チーム管理・大会資料の掲示・協会員の年度更新を行うサイト。最初の協会は早良区協会。サイト名は仮で、`src/lib/site.ts` の `SITE_NAME` だけに書く。

## 開発環境

[docs/setup.md](docs/setup.md) を見る（Dev Container に統一。Node.js 24・pnpm・Postgres 16・Mailpit・Playwright・Claude Code はコンテナの中。Windows は §7）。

## 起動のしかた

1. コンテナを開く（[docs/setup.md](docs/setup.md)）。Postgres（コンテナの中から `db:5432`）と Mailpit（受信箱は http://localhost:8025 ）も一緒に起動する。`.env` は初回に `.env.example` から作られる
2. コンテナの中で `pnpm db:roles`（DB のロールを作る）→ `pnpm db:migrate`（テーブルと拡張を作る）→ `pnpm db:seed`（早良区協会・部門プリセット・`.env` の `SUPER_ADMIN_EMAILS` の運営管理者）。初回と、マイグレーションが増えたとき。どれも何度流してもよい
3. `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 。http://localhost:3000/api/health が `{"ok":true}` なら DB につながっている
4. テスト: `pnpm lint` / `pnpm typecheck` / `pnpm test`（Vitest。`TZ=UTC` と `TZ=Asia/Tokyo` の 2 回。`tests/db/` は Postgres が要る）/ `pnpm test:e2e`（Playwright。WebKit 375×667 と Chromium 360×640）。E2E のレポートは `pnpm exec playwright show-report --host 0.0.0.0` → http://localhost:9323

CI: GitHub Actions（[.github/workflows/ci.yml](.github/workflows/ci.yml)）が pull request と main への push で lint → typecheck → test を流す（Postgres はサービスコンテナ。デプロイは入れない）。

メール: 業務の処理は `mail_logs` に積むだけで、送るのは `pnpm job:mail`（本番は数分おきのジョブ。ローカルでは手で流す）。試すには `pnpm mail:test you@example.com` → `pnpm job:mail` → http://localhost:8025 。

日次の後始末（期限切れの確認番号・セッション・レート制限の削除、期限切れの招待を「期限切れ」にして招待した人に知らせる、保存期間を過ぎた記録の削除、**締切後の申込一覧 CSV のバックアップ**）は `pnpm job:daily`（本番は毎日 3:00 の Cloud Run Jobs）。ローカルのバックアップは `.local-storage/backup/` に暗号化して置かれる（鍵は `.local-storage/backup-test-key.json`・[docs/ops.md](docs/ops.md)）。

開発用: `pnpm db:seed:dev`（サンプルデータ。早良区協会にチーム 3・選手 20・返事待ちの招待 1 を入れる。代表者は `dev-daihyo@example.com`、招待された選手は `dev-senshu@example.com` で、どちらも Mailpit に確認番号が届く。何度流しても増えない）。`pnpm dev:grant-admin you@example.com sawara`（自分を早良区協会の管理者にする）。運営管理者は `.env` の `SUPER_ADMIN_EMAILS` に入れて `pnpm db:seed` → http://localhost:3000/platform で協会を作り、管理者を招待する（招待のメールは `pnpm job:mail` で Mailpit へ → そのアドレスでログイン → http://localhost:3000/invitations で参加）。

DB のほかのコマンド: `pnpm db:generate`（`src/db/schema.ts` からマイグレーションを作る）/ `pnpm db:studio`（→ http://localhost:4983 ）/ `pnpm db:reset`（ローカルだけ。DB を消して作り直す）。

## Phase 1b（大会・申込）でできること

| 範囲 | 中身 |
|---|---|
| 大会の管理（§5.4） | 大会の作成・編集・状態（準備中／受付中／締切／終了）、部はプリセットから一括追加（大会ごとに表示名を変えられる）、部ごとの締切・基準日・上限、基準日を変えたときの警告と「新しい基準日で確定」、大会の削除（削除済みデータから戻せる） |
| 公開ページ（§5.6） | 大会の一覧・大会の詳細・参加チーム一覧（**選手の情報は応答にも入れない**）、`noindex` |
| 申込（§5.5） | 入力 → 確認 → 完了。申し込むチームの選手一覧のプルダウン、名前で探すサジェスト（代表者を務めるチームの選手だけ）、「協会員だけを表示」、手入力（同意の文言）、「この方ですか？」、部の資格の検査、定員・締切の検査、二重送信の防止、**前回コピー** |
| 変更・取消（§5.5(d)） | 締切までは代表者が何度でも変更・取消（取消は戻せない）。締切後は読み取り専用と問い合わせの導線。管理者は締切後も代理で直せ、`entry_audits` に記録が残る |
| 管理者の申込一覧と CSV（§5.5(f)） | 部ごとの件数、運営の確認対象の印と「確認済みにする」、代理で直す・誤登録の削除、CSV（1 選手 1 行・UTF-8 BOM・生年月日はチェックしたときだけ・`export_logs` に記録） |
| 要確認の解消と人物の統合（§5.8） | 「確認が必要」の一覧、横並びの比較、「別の人です」「同じ人です（まとめる）」 |
| マイページ・トップ（§5.3・§5.17） | 代表者として操作できる申込と、選手として出る申込。「あなたのやること」に受付中の大会と申し込み済みの大会 |
| 保存とバックアップ（§6.3・§6.5） | `StorageAdapter`（ローカルは `.local-storage/`、本番は R2）、締切後の申込一覧 CSV を暗号化して日次で保存 |
| 削除済みデータ（§5.16） | 大会・部・申込を `/admin/trash` から復元・完全に削除。人物を完全に削除するときの申込の記録の扱い（保存期間の満了は氏名を残し、本人の依頼・誤登録は「（削除済み）」） |

## Phase 1c（大会資料の掲示）でできること

| 範囲 | 中身 |
|---|---|
| アップロード（§5.9） | 大会ごとに PDF（大会冊子・要項・組み合わせ・結果・その他）。アプリが 10 MB 以下・Content-Type・ファイル先頭の `%PDF-` を検証してから保管用に置く（拡張子だけ `.pdf` にした画像は通らない）。タイトル・公開／非公開・並び順・ファイルの差し替え |
| 公開と配信（§5.9） | 公開中の資料だけを公開用に置く（推測されにくいランダムな名前・`Content-Disposition`・キャッシュ 1 時間）。非公開・削除・大会を準備中に戻す・大会の削除で公開用から消え、復元で戻る。差し替えると新しい名前になる |
| 大会ページ・トップ（§4.2 #6・§5.17） | 資料の一覧（誰でも見られる・押すと「開いています…」）、`/[スラッグ]/tournaments/[id]/documents/[docId]` → 302（開けない資料は 404）、トップの「新しい資料」 |
| 後始末（§5.16・§6.5.1 ⑥） | 大会を完全に削除するとファイルも消す。消し損ねたファイル（DB から指されていないもの）は日次ジョブが消す |

配信方法（独自ドメイン／Workers／アプリ）は `PUBLIC_FILES_BASE_URL` の 1 か所で切り替える（[docs/adr/0026](docs/adr/0026-document-delivery.md)。ローカルは空欄で `/dev-files/…`）。

## Phase 1a（チーム基盤）でできること

### 実装済み

| 範囲 | 中身 |
|---|---|
| ログイン（§9） | メールの確認番号（6 桁・10 分・試行ごとに 5 回まで）、セッション（10 日・スライディング・上限 90 日）、ログアウト、協会の管理者の同時ログインは 1 つまで |
| 協会（§5.14） | URL の先頭のスラッグで協会を決める（旧スラッグは転送）、運営管理者の `/platform`（協会の作成・管理者の招待と解除・切り替えて入る）、協会の切り替えメニュー |
| チーム（§5.11） | チーム名だけで作成、個人登録、チーム情報の編集、無効化・有効に戻す、代表者の委譲（承諾で有効）と解除、マイページ |
| 選手一覧（§5.11・§8.3） | 追加（保存時に名寄せ）、修正、選手一覧から外す・元に戻す、自分を選手として登録する、和暦の入力と年齢の確認 |
| 招待（§5.15） | 選手・代表者・協会の管理者の招待（期限・再送・取り消し）、`/invitations` での承諾と辞退、紐づけの解除 |
| 協会の管理 | チーム・人物の一覧と修正、代表者の付け替え、削除済みデータ（`/admin/trash`）の復元と物理削除 |
| 問い合わせ（§5.10） | 協会宛て・サイト運営者宛てのフォーム、受付控えと転送、管理画面での対応済み化 |
| 規約とアカウント（§5.18・§5.19） | `/privacy`・`/terms`、メールアドレスの変更、アカウントの削除 |
| ジョブ（§6.5.1・§11） | メールの送信（再試行つき）、日次の後始末（期限切れの削除・招待の期限切れ・保存期間を過ぎた記録の削除） |
| 土台 | RLS と `withTenant`、権限表（§3.2）を 1 か所にした認可、404 / 403 / 409 の判定、共通部品とエラーページ、CSS 変数の色 |

### 未実装（あとのフェーズ）

- 大会資料の掲示（1c）、年度更新と会員の承認（1d）
- 名簿の各形式の出力（P1）、利用料・領収書（P1）
- 2 段階認証・ログイン通知（P1）、トップページのカスタマイズと協会ごとの色・ロゴ（P1）
- 日次ジョブのうち DB バックアップ（`pg_dump`）・R2 の後始末・最小インスタンス数の切り替え
- R2 への保存は実装済みだが、**本物の R2 につないで確かめていない**（X-01）
- 本番のデプロイ（Cloud Run・Neon・R2）と監視。`docs/ops.md` の「まだ決めていないこと」

### 既知の課題

- `pnpm test:e2e` を全部いちどに流すと、21 本あたりで dev サーバーが落ちる（コンテナのメモリ不足）。`--project` かファイルを分けて流す
- プライバシーポリシー・利用規約は下書き（`docs/legal/*.md` の末尾の【要確認】を専門家に見てもらってから公開する）
- らくらくスマートフォンの実機で見ていない（文字 150%・200% のスクリーンショットで代用。試用で利用者の端末を見せてもらう）
- 協会員区分の表示は「協会員／非会員」だけ（年度更新が 1d のため。「更新の受付中」などの細かい表示は D-05）

## 進め方

- タスクは [docs/p0-tasks.md](docs/p0-tasks.md) を 1 つずつ。エージェント向けの決まりは [CLAUDE.md](CLAUDE.md)（元は [docs/agent_prompt.md](docs/agent_prompt.md) の F。A〜D の受け入れ条件・E のステップ用プロンプトもここ）
- 進み具合と申し送り: [docs/progress.md](docs/progress.md)
- 設計書: [docs/design/](docs/design/)（節ごと。一覧は [docs/design/index.md](docs/design/index.md)。元は `docs/design.md` v0.9.5）
- 決定の記録: [docs/adr/](docs/adr/)
- 設計書ができるまでの記録: [docs/history/](docs/history/)（`decisions-v0.9*.md`・`review-v0.8.md`。タスクでは読まない）
- 運用手順: [docs/ops.md](docs/ops.md)
- プライバシーポリシー・利用規約: [docs/legal/](docs/legal/)

## 構成

| 場所 | 中身 |
|---|---|
| `src/app/` | Next.js（App Router）の画面と API。`globals.css`・`tokens.css`（色と動きの CSS 変数） |
| `src/lib/` | 正規化・名寄せ・日付・年齢・締切・部門・会員・認可・メール。`site.ts`（サイト名）。`repo/`（DB の読み書き）、`resolve-association.ts`（URL の協会の解決） |
| `src/components/` | 画面の共通部品。`ui/`（ボタン・入力欄・メッセージなど。一覧は開発時の http://localhost:3000/dev/ui ）、`layout/`（ヘッダ・フッタ）、エラー画面 |
| `src/hooks/` | React の hook（入力の一時保存 `useDraft` など） |
| `src/proxy.ts` | すべてのリクエストの前で動く（元の URL をヘッダで渡すだけ。DB には触らない） |
| `src/db/` | Drizzle の `schema.ts`・`migrations/`・接続プール（`client.ts`）・`withTenant`（`tenant.ts`）・DB のスクリプト（`scripts/`） |
| `tests/unit/`・`tests/e2e/` | Vitest・Playwright |
| `tools/` | 開発の補助スクリプト |
| `.devcontainer/` | 開発環境の定義 |
