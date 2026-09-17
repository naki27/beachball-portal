#!/usr/bin/env bash
# コンテナを作ったとき（作り直したときも）に 1 回だけ動く。何度流してもよい
set -euo pipefail
cd /workspaces/beachball-portal

# 名前付きボリュームのうち、リポジトリの中に重ねたものは root の持ち物で作られるので node に渡す
sudo chown node:node node_modules .next

# Mac のファイルは持ち主の番号がコンテナと違うことがあり、git が「dubious ownership」で止まるのを防ぐ
sudo git config --system --add safe.directory /workspaces/beachball-portal

if [ ! -f package.json ]; then
  echo "package.json がまだないので、依存関係のインストールを飛ばします（L-03 で作る）"
  exit 0
fi

pnpm install --config.confirm-modules-purge=false

if [ -f .env.example ] && [ ! -f .env ]; then
  cp .env.example .env
  echo ".env を .env.example から作りました"
fi

if grep -q '"@playwright/test"' package.json; then
  # ブラウザはボリュームに残るので、作り直しで入るのは OS のライブラリだけ
  pnpm exec playwright install --with-deps chromium webkit
fi
