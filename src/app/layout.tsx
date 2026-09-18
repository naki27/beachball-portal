import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/site-footer";
import { DraftHousekeeping } from "@/components/ui/draft-housekeeping";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

// タブの題名: 協会に属さないページは「ページ名｜サイト名」。協会のページは「ページ名｜協会名」（src/app/[slug]/layout.tsx で上書き）
export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s｜${SITE_NAME}` },
  description: SITE_NAME,
  // 検索エンジンに載せない（X-Robots-Tag と robots.txt と三重に）
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// ヘッダは区画ごとの layout が出す（(site) はサイト名、[slug] は協会名）。フッタと電波の帯は全ページ共通
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <OfflineBanner />
        <DraftHousekeeping />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
