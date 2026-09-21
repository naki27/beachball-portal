# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: U-06 UI 刷新の仕上げ・K-01 審判の資格（**Phase 1a・1b・1c・1d と U は完了**。残りは K-02 の軽微な修正と、X-01〜X-05 のデプロイ）
- 次のタスク: K-02 軽微な修正。X-01 本番用の設定は、Phase 0 の人の作業（GCP・Neon・Cloudflare・Brevo）が終わってから
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm db:roles` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000 （`/api/health` が `{"ok":true}` なら DB につながっている）

## 申し送り（新しいものを上に）
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

### UI 刷新 U-01〜U-05（2026-09-21）
- 背景: 利用者から「PC で使いにくい・一覧と登録が同じページ・見た目が素っ気ない」の指摘。**ADR 0028** と設計書 **v0.9.6**（§4.3・§4.5）で方針を変えた。タスクは `docs/p0-tasks.md` §7（U-01〜U-06）
- U-01 土台: 配色を白・`#42B036`（`--brand-500`）・ティールに刷新。**`#42B036` は白文字だと 2.8:1 なので、文字と塗りつぶしのボタンは `--brand-700`（5.37:1）**。角丸・影・イージングのトークンと、器の共通部品（`PageMain` / `PageHeader` / `Card` / `Section` / `Toolbar` / `ActionBar` / `Badge` / `EmptyState`）。`max-w-xl` の直書き 53 か所を置き換え。入力欄の枠 3.1:1・補足の文字 5.96:1。`/dev/ui` に色と器のカタログ
- U-04 一覧と登録の分離: `…/documents/new`・`…/categories/new`・`…/admin/association/presets/new`・`…/admin/memberships/new`。入力欄は `*-fields.tsx` に出して一覧の「直す」と共用。追加のあとは一覧へ戻り、成功のメッセージと足した行の強調（`?added=…`）
- U-02 選手側: 375 / 768 / 1280 の 3 段。大会は `TournamentCard` ＋ `TournamentGrid`（1 → 2 → 3 列）、締切は `deadlineTone`（3 日以内は橙・当日は赤）。大会詳細は PC で 2 列（申し込みは右に固定）。主要操作はスマホだけ下部固定（`ActionBar`）
- U-03 管理画面: `[slug]/admin/layout.tsx` ＋ `AdminNav`（PC は左に貼り付き、狭い画面は上）。**管理者でない人には案内を出さない**（403 の画面に項目を出さない）。管理のトップでは案内を出さない（同じリンクを二重にしない）。一覧は Toolbar ＋カードの格子。参加チーム一覧は部ごとのカード
- U-05 動き: 節目の演出 `Celebrate`（申込の完了・申告の完了だけ。紙吹雪は 1 回・位置と色は固定・「視差効果を減らす」で出さない）。申込の人数表示（下限で緑＋文字も変える）・枠を足したら自動スクロール＋強調・前回コピーで入った枠を強調・外した行がふわっと消える・封筒が 1 回動く。骨組みは `[slug]/admin/loading.tsx` だけ（**`loading.tsx` は 403 を 200 にする**ので管理画面だけにし、管理者かの検査を layout へ。ADR 0029）
- 動作確認: lint / typecheck / test（TZ 2 回・815 本）・`pnpm build`。E2E は 375×667（WebKit）と **1280×800（Chromium・新しく足した）**の両方で、top・public-tournaments・roster・entry-form・entry-manage・documents・admin-tournaments・admin-teams・trash・membership・login-verify・association・ui を流した（ファイルを分けて）
- 次への申し送り:
  - **大会の部の追加だけ、足した行の強調がない**。`addCategoriesFromPresets` が件数しか返さないため（成功のメッセージは出る）
  - ヘッダのように `truncate` を使うときは、親の flex 要素にも `min-w-0` が要る（375px で 10px はみ出していた）
  - **選手側に `loading.tsx` は置けない**（403・404 が 200 になる・ADR 0029）。骨組みが要る所は `DelayedSkeleton` を部品として使う

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
