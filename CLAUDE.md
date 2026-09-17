# CLAUDE.md

## プロジェクト
ビーチボール大会申し込みサイト（仮の名前。最初の協会は早良区協会）。サイト名（タブの題名・ヘッダ・メール）は `src/lib/site.ts` の `SITE_NAME` だけに書き、ほかに直書きしない。設計書は `docs/design/` の節ごとのファイル（一覧は `docs/design/index.md`。元は `docs/design.md` v0.9.5）。進み具合は `docs/progress.md`。決定記録は `docs/adr/`。運用手順は `docs/ops.md`。プライバシーポリシー・利用規約は `docs/legal/`。

## タスクの進め方（利用枠を節約するため。必ず守る）
1. タスクは 1 回に 1 つ。貼られたタスクの範囲だけをやる
2. 最初に `docs/progress.md` を読む
3. **設計書は、タスクの「読む設計書」に書かれた `docs/design/` のファイルだけを読む**。`docs/design.md`（全体）・`docs/design/00-header.md`・`docs/design/14-*.md` は読まない。「〜の部分」と書かれていたら、見出しを Grep で探してその部分だけを読む。ほかの節が必要なら、読む前に私に聞く
4. 既存のコードは、Grep で場所を探してから必要なファイルだけを読む
5. テスト・ビルドの出力は、失敗した部分だけを見る
6. 大きさが［M］のタスクは、最初に計画を 10 行以内で出して承認を待つ
7. 終わったら `pnpm lint` / `pnpm typecheck` / `pnpm test`（画面を変えたら `pnpm test:e2e` も）→ コミット → `docs/progress.md` を更新（50 行以内に保つ）→ 「やったこと / ローカルでの確認手順 / 次への申し送り」を 10 行以内で報告
8. 利用枠が足りなくなりそうなら、区切りのよいところでコミットし、`docs/progress.md` に途中経過を書いて止める

## コマンド
- すべて Dev Container の中で実行する（`docs/setup.md`）。Postgres（`db:5432`）と Mailpit（SMTP `mailpit:1025`、画面 http://localhost:8025）はコンテナと一緒に起動している。`docker` のコマンドはコンテナの中では使えない
- `pnpm dev` / `pnpm build`
- `pnpm test`（Vitest。`TZ=UTC` と `TZ=Asia/Tokyo` の両方）/ `pnpm test:e2e`（Playwright）
- `pnpm lint` / `pnpm typecheck`
- `pnpm db:roles` / `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio`（drizzle-kit）/ `pnpm db:reset`（ローカルだけ）
- `pnpm job:mail` / `pnpm job:daily`（ローカルでは手で実行）

## ローカルでの注意
- ファイル（資料・バックアップ）は `STORAGE_DRIVER=local` で `.local-storage/` に保存する。R2 は本番だけ
- http://localhost では `__Host-` の Cookie と `Secure` 属性を使わない（設定 1 か所で切り替え、本番だけ付ける）
- メールは Mailpit に届く。本物のアドレスには送られない
- `.devcontainer/` は変えない。足りないツールがあれば、`sudo apt install` などで済ませずに私に聞く（全員の環境をそろえるため）

## 規約
- TypeScript strict。`any` 禁止
- DB アクセスは `src/db/` と `src/lib/repo/` 経由。DB を読む処理はすべて `withTenant(associationId, tx => …)` の中で行う。セッション単位の `SET` は使わない
- SQL の直書きは `src/lib/search/` のサジェストと、マイグレーション（RLS のポリシー・`SECURITY DEFINER` 関数・ロールの権限）だけ
- **すべての協会データのクエリに `association_id` を入れる**。リポジトリ関数は `associationId` を必ず受け取る。削除済みの除外は既定にする
- 判定の規則: URL の協会と資源の協会が違う・資源がない → 404／権限がない → 403（未ログインも 403。リダイレクトしない）／締切後・定員など → 409
- ロジックの単一実装を守る:
  - 正規化 → `src/lib/normalize.ts`
  - 名寄せ → `src/lib/matching.ts`
  - 日本時間の日付・今日 → `src/lib/date.ts`
  - 年齢・基準日 → `src/lib/age.ts`
  - 締切・受付の可否 → `src/lib/deadline.ts`
  - 部門バリデーション → `src/lib/eligibility.ts`
  - 会員判定 → `src/lib/membership.ts`
  - 認可 → `src/lib/authz.ts`
  - メールの送信待ち → `src/lib/mail/outbox.ts`
  他の場所で似た処理を書かない
- 認可はサーバー側（Route Handler / Server Action）で必ず検査する。UI の出し分けだけで済ませない
- 個人情報をログ・エラーメッセージに含めない（**生年月日は特に**）。氏名・メールアドレスを URL に載せない
- 生年月日を返す API を増やさない（代表者が務めるチームの選手の情報と、選手本人の情報だけ）。**申込の選手の候補（サジェスト・「この方ですか？」）に、代表者を務めていないチームの人を出さない**
- 画面の文言は設計書 §4.4 の対応表に従う。内部の用語を画面に出さない
- 色は CSS 変数で指定する（協会ごとの色に差し替えるため）
- 選手・代表者の画面は 375px 幅で崩れないこと
- 2 段階認証は P1。P0 のコードに入れない（`authz.ts` に条件を足せる形だけ保つ）
- 設計にない判断は `docs/adr/NNNN-<slug>.md` に残す
- コミットは Conventional Commits。日本語可

## テスト
- 変更したら関連テストを実行してからコミット
- `normalize.ts` / `matching.ts` / `date.ts` / `age.ts` / `deadline.ts` / `eligibility.ts` / `membership.ts` / `authz.ts` はテストなしでの変更禁止
- 権限表（設計書 §3.2）は 1 か所のデータにし、テストはそこから生成する
