import { ErrorScreen } from "@/components/error-screen";
import { SiteHeader } from "@/components/layout/site-header";
import { SITE_NAME } from "@/lib/site";

// 404（協会が決まらない・資源がない・URL の協会と資源の協会が違う・§3.1）。協会の layout の外なので、ヘッダはサイト名
export default function NotFound() {
  return (
    <>
      <SiteHeader title={SITE_NAME} href="/" />
      <ErrorScreen title="ページが見つかりません">
        <p>URL が間違っているか、ページがなくなっています。</p>
      </ErrorScreen>
    </>
  );
}
