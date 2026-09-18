import { headers } from "next/headers";
import { ErrorScreen } from "@/components/error-screen";
import { readForbiddenInfo } from "@/lib/page/forbidden";

// 403 のページ。文言は状況で 3 つ（設計書 §3.1・§4.4）。リダイレクトはしない
// ログインのボタンは、ログインしたあと元のページに戻れるように next に元の URL を持たせる（受け口は A-08 の /login）
export async function ForbiddenScreen() {
  const info = readForbiddenInfo() ?? { reason: "unauthenticated" as const };
  const url = (await headers()).get("x-url") ?? "/";
  const login = { href: `/login?next=${encodeURIComponent(url)}`, label: "ログインする" };

  switch (info.reason) {
    case "unauthenticated":
      return <ErrorScreen title="このページを見るにはログインが必要です" action={login} />;
    case "session_expired":
      return <ErrorScreen title="しばらく操作がなかったため、もう一度ログインしてください" action={login} />;
    case "no_permission":
      return <ErrorScreen title={`このページは${info.who ?? "権限のある人"}だけが見られます`} />;
  }
}
