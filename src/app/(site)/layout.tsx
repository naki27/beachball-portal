import { headers } from "next/headers";
import { type ReactNode, ViewTransition } from "react";
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
      {/* ページが入れ替わるときに本文だけを短くクロスフェードする（§4.5「実装」・ADR 0031）。ヘッダは動かない */}
      <ViewTransition default="none" update="bb-page">
        {children}
      </ViewTransition>
    </>
  );
}
