import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発時だけ: Playwright は http://127.0.0.1:3000 で開くので、dev サーバーが /_next/* をクロスオリジンとして遮らないように
  allowedDevOrigins: ["127.0.0.1"],
  // 開発時だけ: 一度コンパイルしたページを 1 時間メモリに残す。既定（短時間で捨てる）だと、ページが増えるにつれて
  // E2E の途中で捨てたページの再コンパイルが走り、ログインの照合などが時間切れになる
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 },
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
