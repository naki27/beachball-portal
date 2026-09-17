import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SITE_NAME } from "@/lib/site";
import "./globals.css";

// タブの題名: 協会に属さないページは「ページ名｜サイト名」（協会のページの形は A-06）
export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s｜${SITE_NAME}` },
  description: SITE_NAME,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
