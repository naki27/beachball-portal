# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: L-03 Next.js の雛形とテストの土台（人の確認待ち。OK が出てから L-04 に着手）
- 次のタスク: L-04 ローカルの Postgres・Mailpit と DB の土台
- 起動のしかた: コンテナを起動（`docs/setup.md`。Windows は §7）→ コンテナの中で `pnpm dev`（Windows は `pnpm dev:poll`）→ http://localhost:3000

## 申し送り（新しいものを上に）
### L-03（2026-09-17）
- やったこと: Next.js 16.3.5（App Router・TypeScript strict・Tailwind 4・ESLint 9・`src/`）を pnpm で作って移設。`engines` `>=24 <25`・`.nvmrc` `24`・`packageManager` `pnpm@12.4.2`。Vitest 5（`tests/unit/`・`vitest.config.mts`）と Playwright 1.63（`tests/e2e/`。WebKit 375×667・Chromium 360×640）。scripts: `dev` / `dev:poll` / `build` / `lint` / `typecheck` / `test`（TZ 2 回）/ `test:e2e`。`src/lib/site.ts` の `SITE_NAME`、`src/app/tokens.css`（CSS 変数の器）、仮のトップページ、ユニット 1 本・E2E 1 本
- 動作確認: `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm test:e2e` が通る。Windows のブラウザで http://localhost:3000 が開き、375px で横にはみ出さない（E2E で検査）
- 次への申し送り・既知の課題:
  - Windows（9p マウント）では Turbopack の自動再読み込みが効かない（コンテナの中で直しても同じ）。`pnpm dev:poll`（webpack + polling）を使う
  - `pnpm typecheck` は `next typegen && tsc --noEmit`（`next-env.d.ts` と型を生成してから検査）
  - Playwright のブラウザはコンテナのボリューム。作り直したら `post-create.sh` が入れ直す
- 使った枠（/usage の変化）: 未計測

### L-02（2026-09-17）
- やったこと: テンプレート・`docs/design.md`・`tools/split-design.sh`・`docs/legal/templates.md` をコピー。`CLAUDE.md`、`git init -b main`、`.gitignore`、`docs/design/`（節 80・付録 A の表 40）、`docs/adr/README.md`、`README.md`。リポジトリ名を beachball-portal に変更し、GitHub（https://github.com/naki27/beachball-portal.git・HTTPS）に push
- 動作確認: `bash tools/split-design.sh docs/design.md docs/design` が通り、「読む設計書」のファイルはすべてある
- 次への申し送り・既知の課題: 開発マシンは Windows 11。Rancher Desktop + `docker compose` で Dev Container を動かす（`docs/setup.md` §7）。改行は LF（`.gitattributes`）。L-02 のコミットメッセージの「元のファイルは CRLF」は誤りで、元から LF だった（Git Bash の `grep -c $''` は LF のファイルでも全行に当たる。CR は `tr -cd '' < f | wc -c` で数える）
- 使った枠（/usage の変化）: 未計測
