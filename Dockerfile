# アプリ本体のコンテナ（設計書 §6.5.1・§6.6・X-02）。Cloud Run で動かす
# 多段にして、動かすところには standalone の出力（.next/standalone）だけを置く（node_modules も pnpm も入れない）
# root では動かさない。ポートは 8080（Cloud Run の既定）
# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
# pnpm の版は package.json の packageManager から
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# .env は入れない（.dockerignore）。本番の値は Cloud Run が環境変数で渡す（docs/ops.md §9）
RUN pnpm build
# standalone には、動かすのに要らないものも入る（proxy.ts が操作ログを書く先が実行時に決まるため、
# Next がリポジトリ全体を「必要」と見なす・next.config.ts のコメント）。ここで確実に消す。
# .dockerignore でも入らないようにしているが、片方に頼らず両方で防ぐ（logs には IP と User-Agent が入る）
RUN cd .next/standalone \
 && rm -rf src tests tools dist logs playwright-report test-results .local-storage \
      .env .env.* pnpm-lock.yaml tsconfig.tsbuildinfo playwright.config.ts vitest.config.mts \
      drizzle.config.ts eslint.config.mjs CLAUDE.md README.md \
 && if [ -d docs ]; then find docs -mindepth 1 -maxdepth 1 ! -name legal -exec rm -rf {} +; fi

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0
# node:24 のイメージにある node（uid 1000）で動かす
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 8080
# プライバシーポリシー・利用規約の文面（docs/legal/*.md）は
# next.config.ts の outputFileTracingIncludes で standalone に入る（画面が実行時に読む）
CMD ["node", "server.js"]
