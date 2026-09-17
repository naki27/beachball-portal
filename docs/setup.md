# 開発環境のセットアップ（Mac）

開発は全員 **Dev Container**（Linux のコンテナ）の中で行う。Node.js・pnpm・Postgres・Mailpit・Playwright のブラウザ・Claude Code はコンテナに入っていて、定義（`.devcontainer/`）は全員が同じものを使う。Mac に入れるのは次のものだけで、Homebrew と GitHub の準備のほかは `tools/setup-mac.sh` が入れる。

| Mac に入れるもの | 用途 |
|---|---|
| Homebrew | ほかのものを入れる |
| Colima・docker CLI | コンテナを動かす Linux の VM（無料・MIT ライセンス） |
| VS Code・Dev Containers 拡張 | コンテナにつないで編集する |
| Dev Container CLI | コマンドでコンテナを起動する（Homebrew が Node.js も一緒に入れるが、プロジェクトでは使わない） |
| GitHub CLI（gh）・SSH の鍵 | リポジトリの取得と push |

対象: Apple シリコン（M1 以降）の Mac、macOS 13 以降。メモリ 16 GB 以上を勧める（8 GB でも動くが遅い）。ディスクの空きは 30 GB 以上。

## 全体の形

```text
Mac
├─ ブラウザ ─ http://localhost:3000 アプリ / :8025 Mailpit / :9323 Playwright のレポート / https://local.drizzle.studio
├─ VS Code ─────────┐（つなぐ）
└─ Colima（Linux の VM） │
   ├─ app      ←──────┘ ここで開発する。Node.js 24・pnpm・Claude Code・psql
   │                      ~/dev/beachball-portal を /workspaces/beachball-portal として共有
   ├─ db       Postgres 16（app からは db:5432。Mac には公開しない）
   └─ mailpit  メールの受け皿（app からは mailpit:1025）
```

## 決まり

- **ファイルの編集・git・pnpm・claude は、コンテナにつながった VS Code の中（エディタとターミナル）で行う**。Mac のターミナル・Finder・ほかのエディタでリポジトリの中を変えない
  - 理由: Mac 側の変更はコンテナに伝わらないことがあり、`pnpm dev` の自動の再読み込みが効かなくなる。コンテナの中で変えれば確実に伝わる
  - 例外: 最初の `git clone` と、Mac のターミナルで実行する `bash tools/setup-mac.sh`
- リポジトリはホームフォルダの下の `~/dev/beachball-portal` に置く（Colima はホームの下だけを共有する。iCloud Drive の下は避ける）
- コンテナに足りないものがあっても `sudo apt install` で済ませない。作り直すと消えるので、`.devcontainer/Dockerfile` に書いて全員にそろえる（「4. 環境を変えるとき」）

---

## 1. 初回のセットアップ（Mac 1 台につき 1 回）

時間の目安は 30〜60 分（ほとんどはダウンロードの待ち時間）。

### 1-1. Homebrew

ターミナル（アプリケーション → ユーティリティ → ターミナル）で次を実行する。Mac のログインパスワードを聞かれたら入れる。

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

終わりに表示される「Next steps」のコマンド（`echo ... >> ~/.zprofile` と `eval "$(/opt/homebrew/bin/brew shellenv)"`）をそのまま実行する。

- 確認: `brew -v` で版が表示される

### 1-2. Git と GitHub

1. GitHub のアカウントを用意し、リポジトリの管理者に招待してもらい、届いたメールから招待を受ける（最初の 1 台で作る人は不要）
2. ターミナルで:

   ```bash
   brew install gh
   git config --global user.name "山田 太郎"
   git config --global user.email "you@example.com"   # GitHub に登録したアドレス
   gh auth login
   ```

   `gh auth login` の質問には次のように答える。

   | 質問 | 答え |
   |---|---|
   | Where do you use GitHub? | GitHub.com |
   | preferred protocol for Git operations | **SSH** |
   | Generate a new SSH key? | Yes（すでに `~/.ssh/id_ed25519` があれば、それを選ぶ） |
   | passphrase | 空でもよい。入れた場合は Mac のキーチェーンに覚えさせる（下の手順） |
   | Title for your SSH key | そのまま Enter |
   | How would you like to authenticate? | Login with a web browser → 表示されたコードをブラウザに入れる |

3. 鍵を Mac のキーチェーンに覚えさせる（再起動のあとも、コンテナの中から push できるようにするため）

   ```bash
   cat >> ~/.ssh/config <<'EOF'
   Host github.com
     AddKeysToAgent yes
     UseKeychain yes
     IdentityFile ~/.ssh/id_ed25519
   EOF
   ssh-add --apple-use-keychain ~/.ssh/id_ed25519
   ssh -T git@github.com
   ```

- 確認: 最後のコマンドで `Hi <ユーザー名>! You've successfully authenticated` と出る（初回に `Are you sure you want to continue connecting` と聞かれたら `yes`）

### 1-3. リポジトリを取ってくる

**最初の 1 台**（リポジトリを作る人）は、ここと 1-4 以降を飛ばして `p0-tasks.md` の L-02 に進む。

```bash
mkdir -p ~/dev && cd ~/dev
git clone git@github.com:naki27/beachball-portal.git
cd beachball-portal
```

### 1-4. セットアップのコマンド

```bash
bash tools/setup-mac.sh
```

このコマンドがすること（何度実行してもよい）:

1. Colima・docker CLI・Dev Container CLI・jq・VS Code を Homebrew で入れる（入っていれば飛ばす）
2. Colima を起動する。初回は Mac のメモリに合わせて VM の CPU とメモリを決める（Mac のメモリ 16 GB なら VM は 6 GB）
3. GitHub の鍵を ssh-agent に載せる
4. VS Code に Dev Containers 拡張を入れる
5. コンテナをビルドして起動する（初回は 10〜20 分）。中で `.devcontainer/post-create.sh` が動き、`pnpm install`・`.env` の作成・Playwright のブラウザの準備をする
6. コンテナにつながった VS Code を開く

- 確認: VS Code のウィンドウの左下に `Dev Container: beachball-portal`（日本語の表示なら「開発コンテナー」）と出る
- VS Code が開かないとき: VS Code で `~/dev/beachball-portal` を開き、右下に出る「コンテナーで再度開く」を押す（出なければコマンドパレット（⇧⌘P）で `Dev Containers: Reopen in Container`）

### 1-5. Claude Code にログインする（コンテナの中）

VS Code のメニューの「ターミナル → 新しいターミナル」で、コンテナの中のターミナルを開く（場所が `/workspaces/beachball-portal` になっている）。

```bash
claude
```

1. ログインの方法を聞かれたら、**サブスクリプション（Pro）の Claude アカウント**を選ぶ
2. ブラウザが開かなければ、`c` を押して URL をコピーし、Mac のブラウザで開く
3. **各自の** Claude のアカウントでログインする（利用枠はアカウントごと）
4. ブラウザにコードが表示されたら、ターミナルの `Paste code here if prompted` に貼る
5. `/model` で Sonnet になっていることを確かめる（`p0-tasks.md` の §1）→ `/exit`

ログイン情報はコンテナのボリュームに残るので、コンテナを作り直してもログインし直さなくてよい。

### 1-6. 動作の確認

コンテナの中のターミナルで:

```bash
node -v              # v24 で始まる
pnpm -v              # 12 で始まる
claude --version
psql postgresql://postgres:postgres@db:5432/beach -c 'select 1'   # 1 行返る
ssh -T git@github.com                                            # Hi <ユーザー名>! と出る（Mac の鍵がコンテナに渡っている）
```

Mac のブラウザで http://localhost:8025 を開き、Mailpit の画面が出ること。

L-03 のあとなら、さらに `pnpm dev` → http://localhost:3000 が開き、`pnpm test` が通ること。L-04 のあとなら、README の起動のしかた（`pnpm db:migrate` など）も確かめる。

---

## 2. 毎日の作業

### 始める

Mac のターミナルで:

```bash
cd ~/dev/beachball-portal && bash tools/setup-mac.sh
```

Colima とコンテナを起動して VS Code を開く（起動済みなら数秒）。Colima が起動していれば、VS Code の「最近使ったもの」の `beachball-portal [Dev Container]` から開いてもよい。

続けて、コンテナの中のターミナルで:

```bash
git pull
pnpm install      # 依存関係が変わっていなければすぐ終わる
pnpm db:migrate   # L-04 のあと
```

### 終える

- 作業をコミットして push する（コンテナの中のターミナル、または VS Code のソース管理）
- VS Code のウィンドウを閉じる。Mac のメモリを空けたいときは、Mac のターミナルで `colima stop`（コンテナもまとめて止まる）
- DB のデータ・`node_modules`・Claude Code のログインは、止めても作り直しても残る

---

## 3. 複数の Mac で作業するときの注意

- 作業を別の Mac に移すときは、**コミットして push してから**移る。`.env` とローカルの DB のデータは Mac ごとに別で、git には入らない
- `.env` に項目が増えたら（`.env.example` が変わったら）、各自の `.env` にも足す（コンテナを新しく作ったときだけ自動で `.env.example` から作られる）
- `docs/progress.md` の申し送りは git で共有される。同じタスクを 2 人で同時に進めない

---

## 4. 環境を変えるとき（`.devcontainer/` の変更）

- 変える人: `.devcontainer/` を変えたコミットのメッセージに「コンテナの作り直しが必要」と書き、ほかのメンバーに知らせる。Node.js の版を上げるときは、Dockerfile・`.nvmrc`・`package.json` の `engines`・本番のイメージを一緒に変える
- ほかの人: `git pull` のあと、Mac のターミナルで `bash tools/setup-mac.sh --rebuild`（VS Code のコマンドパレットの `Dev Containers: Rebuild Container` でもよい）
- 作り直しても残るもの: DB のデータ、`node_modules`、`.next`、pnpm のキャッシュ、Playwright のブラウザ、Claude Code のログインと設定（すべて名前付きボリューム）
- 作り直すと消えるもの: コンテナの中で手で入れたもの、シェルの履歴

---

## 5. 困ったとき

| 症状 | 対処 |
|---|---|
| `Cannot connect to the Docker daemon` | Mac のターミナルで `colima status` → 止まっていれば `bash tools/setup-mac.sh` |
| ファイルを保存しても `pnpm dev` の画面が変わらない | Mac 側（Finder・Mac のエディタ・Mac のターミナルの git）で変えていないか確かめ、コンテナの中でやり直す。それでもだめなら `WATCHPACK_POLLING=true pnpm dev --webpack` |
| `Permission denied` や `Operation not permitted` がたまに出る（git・大量のファイルの書き込み） | もう一度実行する（Colima のファイル共有（virtiofs）の既知の問題）。頻繁に出るならメンバーに相談する |
| git が `dubious ownership` で止まる | コンテナの中で `sudo git config --system --add safe.directory /workspaces/beachball-portal` |
| `git push` が `Permission denied (publickey)` | Mac のターミナルで `ssh-add --apple-use-keychain ~/.ssh/id_ed25519` → `bash tools/setup-mac.sh`（VS Code のウィンドウが開き直る） |
| コミットで `Please tell me who you are` | Mac のターミナルで 1-2 の `git config --global` をして、VS Code のウィンドウを開き直す（Mac の設定がコンテナに写される） |
| `port is already allocated`（3000・8025 など） | Mac でほかに動いているもの（別の開発サーバーなど）を止める。使っているものは Mac のターミナルで `lsof -iTCP:3000 -sTCP:LISTEN` |
| Drizzle Studio が Safari で開けない | Chrome で https://local.drizzle.studio を開く |
| コンテナの調子がおかしい | `bash tools/setup-mac.sh --rebuild` |
| DB を空にしたい | L-04 のあと: コンテナの中で `pnpm db:reset`（ローカルだけのコマンド） |
| ディスクが足りない | Mac のターミナルで `docker system prune`（止まっているコンテナと使っていないイメージを消す。ボリュームは消えない） |
| どうしても直らない | 最後の手段: Mac のターミナルで `colima delete` → `bash tools/setup-mac.sh`（**DB のデータと Claude Code のログインも消える**。push していない作業はリポジトリのフォルダに残る） |

---

## 6. 参考: 仕組み

| ファイル | 中身 |
|---|---|
| `.devcontainer/devcontainer.json` | どのサービスにつなぐか、VS Code の拡張、作成後に動くスクリプト |
| `.devcontainer/compose.yaml` | app・db（Postgres 16）・mailpit の 3 つ。ポートとボリューム |
| `.devcontainer/Dockerfile` | app の中身（Node.js 24・pnpm・psql・Claude Code） |
| `.devcontainer/post-create.sh` | コンテナを作ったときに 1 回動く（ボリュームの持ち主・`pnpm install`・`.env`・Playwright） |
| `tools/setup-mac.sh` | Mac 側の準備と起動 |

Mac に公開するポート（どれも Mac の中からだけ開ける。`--lan` のときだけ 3000 を同じ Wi-Fi に公開する）

| ポート | 用途 |
|---|---|
| 3000 | アプリ（`pnpm dev`） |
| 8025 | Mailpit の画面 |
| 4983 | Drizzle Studio（`pnpm db:studio`） |
| 9323 | Playwright のレポート（`pnpm exec playwright show-report --host 0.0.0.0`） |

コンテナの中から見た接続先

| 相手 | 接続先 |
|---|---|
| Postgres | `db:5432`（ローカルの管理者 `postgres` / `postgres`。アプリ用のロールは L-04 で作る） |
| Mailpit の SMTP | `mailpit:1025` |

Colima の代わりに、すでにライセンスのある Docker Desktop などを使う場合は `USE_CURRENT_DOCKER=1 bash tools/setup-mac.sh`。コンテナの中身は同じになる。
