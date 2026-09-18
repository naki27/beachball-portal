import { headers } from "next/headers";
import type { ReactNode } from "react";
import { AuthMenu } from "@/components/layout/auth-menu";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_NAME } from "@/lib/site";

// 協会に属さないページ（/、/login 系、/mypage 系、/platform 系、/privacy、/terms など）。ヘッダにはサイト名
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const currentPath = (await headers()).get("x-url") ?? "/";
  // ログイン画面の中では「ログイン」のリンクを出さない
  const right = currentPath.startsWith("/login") ? null : <AuthMenu currentPath={currentPath} />;
  return (
    <>
      <SiteHeader title={SITE_NAME} href="/" right={right} />
      {children}
    </>
  );
}
