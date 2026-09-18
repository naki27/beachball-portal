import type { MetadataRoute } from "next";

// 検索エンジンに載せない（全ページ noindex と二重に）
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
