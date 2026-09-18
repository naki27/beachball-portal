import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 開発時だけ: Playwright は http://127.0.0.1:3000 で開くので、dev サーバーが /_next/* をクロスオリジンとして遮らないように
  allowedDevOrigins: ["127.0.0.1"],
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
