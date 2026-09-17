# 開発用コンテナ（Mac は arm64、CI や本番は amd64。どちらのイメージもある）
# Node.js 24（Active LTS・2028-04 まで）。上げるときは本番のイメージと .nvmrc・engines も合わせる
FROM mcr.microsoft.com/devcontainers/typescript-node:5-24-trixie

# psql（DB を手で確認するとき用）
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*

# pnpm。package.json の packageManager に書いた版へ自動で切り替わる
RUN npm install -g pnpm@12

USER node

# 名前付きボリュームの置き場所を node の持ち物で作っておく（空のボリュームは、この持ち主を引き継ぐ）
RUN mkdir -p /home/node/.claude /home/node/.local/share/pnpm/store /home/node/.cache/ms-playwright /home/node/.ssh \
  && chmod 700 /home/node/.ssh \
  && ssh-keyscan -t ed25519,ecdsa,rsa github.com >> /home/node/.ssh/known_hosts 2>/dev/null

# Claude Code（公式のインストーラー。~/.local/bin に入り、自動で更新される）
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH=/home/node/.local/bin:$PATH
