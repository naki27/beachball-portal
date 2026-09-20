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

日次の後始末（期限切れの確認番号・セッション・レート制限の削除、期限切れの招待を「期限切れ」にして招待した人に知らせる、保存期間を過ぎた記録の削除）は `pnpm job:daily`（本番は毎日 3:00 の Cloud Run Jobs）。

開発用: `pnpm db:seed:dev`（サンプルデータ。早良区協会にチーム 3・選手 20・返事待ちの招待 1 を入れる。代表者は `dev-daihyo@example.com`、招待された選手は `dev-senshu@example.com` で、どちらも Mailpit に確認番号が届く。何度流しても増えない）。`pnpm dev:grant-admin you@example.com sawara`（自分を早良区協会の管理者にする）。運営管理者は `.env` の `SUPER_ADMIN_EMAILS` に入れて `pnpm db:seed` → http://localhost:3000/platform で協会を作り、管理者を招待する（招待のメールは `pnpm job:mail` で Mailpit へ → そのアドレスでログイン → http://localhost:3000/invitations で参加）。

DB のほかのコマンド: `pnpm db:generate`（`src/db/schema.ts` からマイグレーションを作る）/ `pnpm db:studio`（→ http://localhost:4983 ）/ `pnpm db:reset`（ローカルだけ。DB を消して作り直す）。

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

- 大会・部門・申込・参加チーム一覧・申込一覧 CSV・サジェスト（1b）、大会資料の掲示（1c）、年度更新と会員の承認（1d）
- 人物の統合の画面（1b）、名簿の各形式の出力（P1）、利用料・領収書（P1）
- 2 段階認証・ログイン通知（P1）、トップページのカスタマイズと協会ごとの色・ロゴ（P1）
- 日次ジョブのうち DB バックアップ・申込一覧 CSV のバックアップ・R2 の後始末・最小インスタンス数の切り替え
- 本番のデプロイ（Cloud Run・Neon・R2）と監視。`docs/ops.md` の「まだ決めていないこと」

### 既知の課題

- `pnpm test:e2e` を全部いちどに流すと、21 本あたりで dev サーバーが落ちる（コンテナのメモリ不足）。`--project` かファイルを分けて流す
- プライバシーポリシー・利用規約は下書き（`docs/legal/*.md` の末尾の【要確認】を専門家に見てもらってから公開する）
- らくらくスマートフォンの実機で見ていない（文字 150%・200% のスクリーンショットで代用。試用で利用者の端末を見せてもらう）
- 申込がまだないので、チームの無効化・人物の削除で見る「締切前の申込」の数は常に 0（B-01 でつながる）

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
