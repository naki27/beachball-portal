#!/usr/bin/env bash
# Mac で開発用コンテナ（Dev Container）を用意して、VS Code をコンテナにつないで開く。
# 何度実行してもよい（毎日の作業の始めにもこれを使う）。手順の全体は docs/setup.md。
#
# 使い方（Mac のターミナルで、リポジトリの直下で）:
#   bash tools/setup-mac.sh            必要なものを入れ、コンテナを起動して VS Code を開く
#   bash tools/setup-mac.sh --rebuild  コンテナを作り直す（.devcontainer/ が変わったとき・調子が悪いとき）
#   bash tools/setup-mac.sh --lan      同じ Wi-Fi のスマホから開けるようにして作り直す（戻すときは --rebuild）
#   bash tools/setup-mac.sh --no-open  VS Code を開かない
#
# Colima の代わりに、すでに動いている Docker（Docker Desktop など）を使う場合:
#   USE_CURRENT_DOCKER=1 bash tools/setup-mac.sh
#   ※ Docker Desktop は組織の規模などによって有料。使う人がライセンスの条件を確認する
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace=/workspaces/beach-entry
rebuild=0
open_vscode=1
export APP_BIND=127.0.0.1

for arg in "$@"; do
  case "$arg" in
    --rebuild) rebuild=1 ;;
    --lan) rebuild=1; APP_BIND=0.0.0.0 ;;
    --no-open) open_vscode=0 ;;
    *) echo "不明な引数です: $arg（使い方はこのファイルの先頭）" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
fail() { printf '\n[中断] %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- 前提の確認
[ "$(uname -s)" = Darwin ] || fail "Mac で実行してください"
[ "$(uname -m)" = arm64 ] || echo "注意: Intel の Mac では確かめていません（動くはずですが遅くなります）"
[ -f "$repo/.devcontainer/devcontainer.json" ] || fail ".devcontainer/devcontainer.json がありません: $repo"
case "$repo" in
  "$HOME"/Library/*)
    fail "iCloud Drive の中です。~/dev/beach-entry などに移してください: $repo" ;;
  "$HOME"/Documents/*|"$HOME"/Desktop/*)
    echo "注意: 書類・デスクトップは iCloud Drive で同期されることがあります。~/dev/beach-entry などを勧めます" ;;
  "$HOME"/*) ;;
  *) fail "リポジトリをホームフォルダの下（例: ~/dev/beach-entry）に置いてください。Colima はホームの下だけをコンテナと共有します: $repo" ;;
esac
command -v brew >/dev/null 2>&1 || fail "Homebrew がありません。docs/setup.md の「1-1. Homebrew」を先にやってください"

# ---------------------------------------------------------------- Mac に入れるもの
step "Homebrew で必要なものを入れる（入っていれば飛ばす）"
formulae="devcontainer jq"
if [ "${USE_CURRENT_DOCKER:-0}" != 1 ]; then
  formulae="colima docker docker-compose docker-buildx $formulae"
fi
for f in $formulae; do
  if brew list --formula "$f" >/dev/null 2>&1; then
    echo "入っています: $f"
  else
    brew install "$f"
  fi
done

code_bin=""
for app in "/Applications/Visual Studio Code.app" "$HOME/Applications/Visual Studio Code.app"; do
  if [ -d "$app" ]; then code_bin="$app/Contents/Resources/app/bin/code"; fi
done
if [ -z "$code_bin" ]; then
  brew install --cask visual-studio-code
  code_bin="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
else
  echo "入っています: Visual Studio Code"
fi

# ---------------------------------------------------------------- コンテナの実行環境
if [ "${USE_CURRENT_DOCKER:-0}" = 1 ]; then
  step "いま動いている Docker を使う（USE_CURRENT_DOCKER=1）"
  docker info >/dev/null 2>&1 || fail "Docker に接続できません。Docker Desktop などを起動してください"
else
  # Homebrew の docker に compose と buildx のプラグインの場所を教える
  plugins_dir="$(brew --prefix)/lib/docker/cli-plugins"
  docker_cfg="$HOME/.docker/config.json"
  mkdir -p "$HOME/.docker"
  [ -f "$docker_cfg" ] || echo '{}' > "$docker_cfg"
  if ! jq -e --arg d "$plugins_dir" '(.cliPluginsExtraDirs // []) | index($d)' "$docker_cfg" >/dev/null; then
    tmp="$(mktemp)"
    jq --arg d "$plugins_dir" '.cliPluginsExtraDirs = ((.cliPluginsExtraDirs // []) + [$d])' "$docker_cfg" > "$tmp"
    mv "$tmp" "$docker_cfg"
  fi

  step "Colima（コンテナを動かす Linux の VM）を起動する"
  if colima status >/dev/null 2>&1; then
    echo "起動しています"
  elif colima list 2>/dev/null | grep '^default[[:space:]]' >/dev/null; then
    colima start   # 2 回目からは、初回に保存した設定で起動する
  else
    mem_gb=$(( $(sysctl -n hw.memsize) / 1073741824 ))
    if [ "$mem_gb" -ge 24 ]; then vm_mem=8; elif [ "$mem_gb" -ge 16 ]; then vm_mem=6; else vm_mem=4; fi
    vm_cpus=$(( $(sysctl -n hw.ncpu) / 2 ))
    if [ "$vm_cpus" -lt 2 ]; then vm_cpus=2; fi
    if [ "$vm_cpus" -gt 6 ]; then vm_cpus=6; fi
    echo "初回: CPU ${vm_cpus} 個・メモリ ${vm_mem} GB で作ります（Mac のメモリ ${mem_gb} GB）"
    colima start --vm-type vz --mount-type virtiofs --mount-inotify --cpus "$vm_cpus" --memory "$vm_mem"
  fi
  docker context use colima >/dev/null
  docker compose version >/dev/null 2>&1 || fail "docker compose が使えません。brew reinstall docker-compose を試してください"
fi

# ---------------------------------------------------------------- GitHub の鍵
step "GitHub の鍵を ssh-agent に載せる（コンテナの中から push するため）"
if ssh-add -l >/dev/null 2>&1; then
  echo "載っています"
else
  ssh-add --apple-load-keychain >/dev/null 2>&1 || true
  if ! ssh-add -l >/dev/null 2>&1; then
    if [ -f "$HOME/.ssh/id_ed25519" ]; then
      ssh-add --apple-use-keychain "$HOME/.ssh/id_ed25519" || echo "注意: 鍵を載せられませんでした。push できなければ docs/setup.md の「1-2」を確認"
    else
      echo "注意: ~/.ssh/id_ed25519 がありません。push できなければ docs/setup.md の「1-2」を確認"
    fi
  fi
fi

# ---------------------------------------------------------------- VS Code とコンテナ
step "VS Code の Dev Containers 拡張を入れる"
"$code_bin" --install-extension ms-vscode-remote.remote-containers >/dev/null
echo "入っています: ms-vscode-remote.remote-containers"

step "開発用コンテナを起動する（初回は 10〜20 分。2 回目からは数秒）"
if [ "$rebuild" = 1 ]; then
  devcontainer up --workspace-folder "$repo" --remove-existing-container
else
  devcontainer up --workspace-folder "$repo"
fi

if [ "$APP_BIND" = 0.0.0.0 ]; then
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  echo
  echo "スマホから開く: コンテナの中で pnpm dev → http://${ip:-<Mac の IP>}:3000"
  echo "（ファイアウォールの許可を聞かれたら許可する。終わったら bash tools/setup-mac.sh --rebuild で元に戻す）"
fi

if [ "$open_vscode" = 1 ]; then
  step "VS Code をコンテナにつないで開く"
  hex="$(printf '%s' "$repo" | xxd -p | tr -d '\n')"
  "$code_bin" --folder-uri "vscode-remote://dev-container+${hex}${workspace}"
  echo "開かなければ: VS Code でこのフォルダを開き、「コンテナーで再度開く」を押す"
fi

echo
echo "完了。作業はコンテナにつながった VS Code の中（エディタとターミナル）で行ってください。"
