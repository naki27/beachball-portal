import type { ReactNode } from "react";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_NAME } from "@/lib/site";

// 協会に属さないページ（/、/login 系、/mypage 系、/platform 系、/privacy、/terms など）。ヘッダにはサイト名
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader title={SITE_NAME} href="/" />
      {children}
    </>
  );
}
