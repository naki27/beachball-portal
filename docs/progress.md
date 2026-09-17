# 進み具合と申し送り

タスクの最初に読み、最後に更新する。**50 行以内に保つ**（古い申し送りは docs/progress-archive.md に移す。そちらは読まない）。

## 今の状態
- 最後に終わったタスク: L-02 リポジトリと作業の決まり
- 次のタスク: L-02 の「人がやること（エージェントのあと）」（GitHub のリポジトリ作成と push）→ L-03 Next.js の雛形とテストの土台
- 起動のしかた: まだなし（L-03 で `pnpm dev`、L-04 で DB）

## 申し送り（新しいものを上に）
### L-02（2026-09-17）
- やったこと: テンプレート（`.devcontainer/`・`tools/setup-mac.sh`・`docs/setup.md`・`.gitattributes`）、`docs/design.md`、`tools/split-design.sh`、`docs/legal/templates.md` をコピー。`CLAUDE.md`（agent_prompt.md の F）、`git init -b main`、`.gitignore`、`docs/design/`（節 80・付録 A の表 40）、`docs/adr/README.md`、`README.md`、最初のコミット
- 動作確認: `bash tools/split-design.sh docs/design.md docs/design` が通り、`docs/design/index.md` と `docs/design/appendix-a/` がある。p0-tasks.md の「読む設計書」に出るファイルはすべてある
- 次への申し送り・既知の課題:
  - 開発マシンが Mac ではなく **Windows 11**（WSL2 の Ubuntu 24.04 あり。Docker は Rancher Desktop で停止中。Node は WSL に 18 のみ、pnpm・gh・GitHub の SSH 鍵はなし）。`tools/setup-mac.sh` は Mac 専用（`uname` で止まる）。Dev Container を Windows（Rancher Desktop + WSL2）で使うか、WSL の中で直接動かすかを決めてから L-03 に進む
  - 元のファイルはすべて CRLF だったので、コピー後に LF へ直した（`.gitattributes` は `eol=lf`）
  - GitHub への push は未（`gh` と SSH 鍵の準備が必要。`docs/setup.md` の `<OWNER>` も未置換）
- 使った枠（/usage の変化）: 未計測（この環境では /usage を見られない）
