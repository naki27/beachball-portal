import { ForbiddenScreen } from "@/components/forbidden-screen";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_NAME } from "@/lib/site";

// 403（協会に属さない画面）。ヘッダはサイト名
export default function Forbidden() {
  return (
    <>
      <SiteHeader title={SITE_NAME} href="/" />
      <ForbiddenScreen />
    </>
  );
}
