import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本番はコンテナで動かす（§6.5.1・X-02）。.next/standalone に必要なものだけをまとめる（node_modules を入れずに済む）
  output: "standalone",
  // 開発時だけ: Playwright は http://127.0.0.1:3000 で開くので、dev サーバーが /_next/* をクロスオリジンとして遮らないように
  allowedDevOrigins: ["127.0.0.1"],
  // 開発時だけ: 一度コンパイルしたページを 1 時間メモリに残す。既定（短時間で捨てる）だと、ページが増えるにつれて
  // E2E の途中で捨てたページの再コンパイルが走り、ログインの照合などが時間切れになる
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 },
  // 本番のビルドに、プライバシーポリシー・利用規約の文面（docs/legal/*.md）を含める（§5.18。画面が実行時に読む）
  // proxy.ts が操作ログを書く先（ACCESS_LOG_DIR）は実行時に決まるので、Next は「リポジトリ全体が実行時に必要」と
  // 見なし、.next/standalone に src・tests なども入る。outputFileTracingExcludes は proxy の分には効かないので、
  // 要らないものは Dockerfile で消す（X-02）
  outputFileTracingIncludes: {
    "/privacy": ["./docs/legal/*.md"],
    "/terms": ["./docs/legal/*.md"],
    // pg（node-postgres）は pg-protocol を require するが、Next は package.json だけを写して本体（dist）を入れない。
    // 入っていないと DB につなげず、どの画面も 500・/api/health が 503 になる（X-02 で見つけた）
    "/*": ["node_modules/.pnpm/pg-protocol@*/node_modules/pg-protocol/dist/**"],
  },
  experimental: {
    // forbidden() で 403 のページを返す（リダイレクトしない・設計書 §3.1）
    authInterrupts: true,
  },
  async headers() {
    return [
      {
        // 検索エンジンに載せない（全ページ。meta の noindex と二重に）
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
