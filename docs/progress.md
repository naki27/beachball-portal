# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: K-02 軽微な修正（**Phase 1a・1b・1c・1d・U と K は完了**。残りは X-01〜X-05 のデプロイ）
- 次のタスク: X-01 本番用の設定。Phase 0 の人の作業（GCP・Neon・Cloudflare・Brevo）が終わってから
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
### K-02 軽微な修正（2026-09-21）
- 文言: チームの「代表者」→**「代表者を追加・変更する」**／画面の「よく使う部」→**「よく使う部門」**（28 か所）／申込の備考の注意書きを
  「ビブスの貸し出しや審判についてなど、お気軽にお問い合わせください。」に差し替え
- **線で区切る UI**: `DescriptionList` / `DescriptionRow` を `ui/layout.tsx` に追加（行ごとに区切り線・スマホは縦積み）。
  チーム情報・申込の詳細・申込の確認・大会の詳細を置き換え、マイページは協会の枠の中のまとまりを線で分けた。`/dev/ui` にカタログ
- **「個人で登録する」のテナント切替（ADR 0032）**: `associations.individual_registration_enabled`（既定 true・マイグレーション **0019**）。
  `/（スラッグ）/admin/association` で切り替える（`PATCH /api/（スラッグ）/admin/association`）。止めるとトップ・マイページのリンクが消え、
  登録のページと `registerIndividual()` が **404**（最後の砦は `src/lib/teams/self.ts` の中の 1 か所）。すでに登録した人はそのまま
- **アイコン**: 公式球（緑の球＋白い帯）をデフォルメ。`SiteMark`（ヘッダ・CSS 変数）と `src/app/icon.svg`・`favicon.ico`・`apple-icon.png`。**形を変えるときは両方直す**
- 動作確認: lint / typecheck / test（TZ 2 回・829 本）。E2E は association-settings（新規）・teams・team-admins・individual・entry-form・
  entry-manage・public-tournaments・top・ui を WebKit 375 で、screens を 1280 で流した
- 次への申し送り:
  - **dev サーバーを付けっぱなしにしたままスキーマを変えると、古い列のまま動いて 500 になる**（drizzle の `escapeName` で落ちる）。
    `pnpm db:migrate` のあとは dev サーバーを入れ直す
  - 協会ごとの設定は `/（スラッグ）/admin/association` に足していく（色・連絡先はまだ）

### U-07 動きを各所に広げる（2026-09-21）
- 背景: 「操作していて楽しくなる動きを各所に」の要望。§4.5 原則 1 は**飾りの動きを禁じ、「楽しさは色・影・カードの浮き・ホバーの反応で出す」**としているので、
  新しい飾りは足さず、**U-05 で作った語彙をまだ効いていない所へ広げた**。タスクは `docs/p0-tasks.md` §7 の U-07
- 入力の部品: `input` / `select` / `textarea` の枠と影の変わり方、チェック・ラジオの `accent-color` と選んだときの印を `globals.css` 1 か所に（画面ごとに直書きしている素の要素に全部効く）
- 一覧: `Card` に `hoverable`（中にリンクがある行。枠と影だけ変わる。`interactive` は今までどおり浮く）を足して 8 か所。まだ付いていなかった一覧 10 か所に `bb-stagger`
- リンク: **下線の引き方を `bb-link` 1 か所に寄せた**（`underline underline-offset-2` の直書き 51 か所を置換）。`inline-flex min-h-11` のリンクで
  下線が文字から 20px 離れていたので、`background-image` ではなく `text-decoration-thickness` を動かす形に変えた
- 確認の帯・「この方ですか？」の候補・選ぶ行（`bb-choice` ＋ `has-[:checked]:`）に、出たことが分かる動きを足した
- **ページの入れ替え（ADR 0031）**: `(site)` と `[slug]` の layout で本文だけを 200ms クロスフェード（React の `<ViewTransition>`。Next 16 は設定不要）。
  ヘッダ・フッタは動かない。管理の案内の「今いるところ」の印は `name="admin-nav-current"` で前の項目から移る。未対応のブラウザでは何も起きない
- 動作確認: lint / typecheck / test（TZ 2 回・825 本）・`pnpm build`。E2E は ui・screens（1280）と、entry-form・roster・membership・documents・trash・admin-tournaments・top・ui（WebKit 375）
- 次への申し送り:
  - **E2E でスクリーンショットを撮る前は入れ替えの終わりを待つ**（`screens.spec.ts` の `settled()`）。待たないと半透明の途中が写る
  - `bb-link` を使うときは `no-underline` を付けない（下線は `bb-link` が引く）

### 持ち越しの課題（2026-09-20 まで）
- **大会資料の配信方法（§5.9 の第 1〜3 案）は未決定**。`PUBLIC_FILES_BASE_URL` 1 か所で切り替わる（ADR 0026）。X-05 で決める
- R2 のアダプタは**本物の R2 につないで確かめていない**（X-01）。`Content-Disposition` / `Cache-Control` も一緒に確かめる
- 依頼メールの一斉送信・督促、前年度の名簿の取り込み、名簿の各形式の出力は P1。「追加の申告」で会員を**外す**のは運営の代理だけ（§5.12【仮】）
- 管理者が定員を超えて登録するときの確認は未実装（1b からの持ち越し）
- **E2E は全部いちどに流すと dev サーバーが落ちる**（コンテナのメモリ）。ファイルを分けて流す
