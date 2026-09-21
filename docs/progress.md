# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: U-07 動きを各所に広げる（**Phase 1a・1b・1c・1d と U は完了**。残りは K-02 の軽微な修正と、X-01〜X-05 のデプロイ）
- 次のタスク: K-02 軽微な修正。X-01 本番用の設定は、Phase 0 の人の作業（GCP・Neon・Cloudflare・Brevo）が終わってから
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
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

### U-06 仕上げ・K-01 審判の資格（2026-09-21）
- **U-06**: `tests/e2e/screens.spec.ts` を追加。主要な 10 画面 × 幅 375/768/1280 × 文字サイズ 100/150/200% で、
  はみ出し・タップ領域（44px）を機械で確かめ、スクリーンショットを 90 枚残す。流し方は `docs/ops.md` §6-2（**プロジェクトは 1 つだけ指定する**）
  - 直したもの: **格子の升目が縮まない**（`globals.css` に `:where(.grid) > * { min-width: 0 }` を 1 か所）／`Badge` に `max-w-full`／申込のステッパーを `flex-wrap`（丸も rem で大きくなる）／申込一覧のチーム名に `min-w-0`／44px に足りなかったリンク 8 か所
  - **`<Button className="min-h-10">` は効いていなかった**（SIZE_CLASS が勝つ）。43 か所を `size="sm"`（44px）と素の要素の `min-h-11` に置き換えた
  - `tests/unit/tokens-contrast.test.ts` で `tokens.css` のコントラスト比を数える（文字 4.5:1・枠 3:1）
- **K-01**: `members.referee_grade`（a/b/c・なしは null）と `referee_no`（数字 6 桁・text）を追加（マイグレーション **0018**）。**ADR 0030**
  - 入力は `PlayerForm`（選手の追加・修正・個人で登録・自分を選手として登録）とメンバー管理。**申込の選手枠には入れない**
  - 見せる範囲: **級はチームの人みんな、審判Noは生年月日と同じ範囲**（`viewPlayerPersonal`）。名寄せのキーには入れない
  - **追加の画面の空欄は「変えない」**（既にある人物の資格を消さない）。修正の画面の空欄は「なし」
  - 色は `--referee-{a,b,c}`（文字・面・枠・丸い印）。赤・黄・白は文字にできないので、**丸い印だけが級の色**。`/dev/ui` にカタログ
- 動作確認: lint / typecheck / test（TZ 2 回・825 本）・`pnpm build`。E2E は screens（1280 のみ）と、roster・ui・entry-form・entry-manage・admin-tournaments・admin-teams・membership・individual・top・public-tournaments・teams・documents・trash・login-verify・association を WebKit 375 で、roster・admin-tournaments・ui は 1280 でも流した

### 運用フロー図（2026-09-21）
- やったこと: `docs/ops.md` の先頭に「0. 全体像」を追加。mermaid の図（凡例＋登場人物と入口 / サイトマップ 利用者 / サイトマップ 管理者・運営 / 大会 1 回分の流れ / 1 年の流れ・年度更新 / ジョブ・メール・保存先）。URL は `src/app` の実際のルートから起こした。9 分類（登場人物・公開・ログイン・代表者・申し込み・協会管理者・運営管理者・バックエンド・保管先）で色分け、全図共通の `classDef`（淡い塗り＋濃い文字色でコントラストを確保）。**画面や分類を増やしたらここも直す**
### 利用者の操作ログ（2026-09-21）
- やったこと: `src/proxy.ts` から `src/lib/access-log` を呼び、リクエストを 1 行 1 件（JSON Lines）で記録。時刻（日本時間）・メソッド・パス・クエリ（`q`・`name`・`code` などは値を `***`）・協会スラッグ・Server Action の id・セッションのハッシュ（`sessions.session_hash` と同じ）・IP・User-Agent。応答のステータスは残さない（proxy からは見えない）。`ACCESS_LOG_DRIVER`（`file` 既定 / `stdout` / `off`）で切り替え、file は月替わりか 100 MB で退避して 6 世代（半年）残す。ADR 0027・`docs/ops.md`「操作ログ」・`.env.example`
- 動作確認: lint / typecheck / test（TZ 2 回・813 本）・`pnpm build`。dev サーバーに curl して `logs/access.log` に出ること、`q` が伏せ字になること、`/api/health` が記録されないこと、セッションのハッシュが `sha256` と一致することを確かめた
- 次への申し送り: **X-01 で本番の環境変数に `ACCESS_LOG_DRIVER=stdout` を入れ、Cloud Logging の保存期間を 180 日にする**（Cloud Run はファイルが消えるのでファイル方式は使えない）
### 持ち越しの課題（2026-09-20 まで）
- **大会資料の配信方法（§5.9 の第 1〜3 案）は未決定**。`PUBLIC_FILES_BASE_URL` 1 か所で切り替わる（ADR 0026）。X-05 で決める
- R2 のアダプタは**本物の R2 につないで確かめていない**（X-01）。`Content-Disposition` / `Cache-Control` も一緒に確かめる
- 依頼メールの一斉送信・督促、前年度の名簿の取り込み、名簿の各形式の出力は P1。「追加の申告」で会員を**外す**のは運営の代理だけ（§5.12【仮】）
- 管理者が定員を超えて登録するときの確認は未実装（1b からの持ち越し）
- **E2E は全部いちどに流すと dev サーバーが落ちる**（コンテナのメモリ）。ファイルを分けて流す
