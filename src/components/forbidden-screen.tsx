import { headers } from "next/headers";
import { ErrorScreen } from "@/components/error-screen";
import { getPrincipal } from "@/lib/auth/principal";
import { whoCanSee } from "@/lib/page/forbidden";

// 403 のページ。文言は状況で 3 つ（設計書 §3.1・§4.4）。リダイレクトはしない
// 未ログイン・セッション切れはセッションの状態から、「誰なら見られるか」は URL から決める（src/lib/page/forbidden.ts）
// ログインのボタンは、ログインしたあと元のページに戻れるように next に元の URL を持たせる（受け口は /login）
export async function ForbiddenScreen() {
  const url = (await headers()).get("x-url") ?? "/";
  const principal = await getPrincipal();
  const login = { href: `/login?next=${encodeURIComponent(url)}`, label: "ログインする" };

  switch (principal.sessionState) {
    case "none":
      return <ErrorScreen title="このページを見るにはログインが必要です" action={login} />;
    case "expired":
      return <ErrorScreen title="しばらく操作がなかったため、もう一度ログインしてください" action={login} />;
    case "active":
      return <ErrorScreen title={`このページは${whoCanSee(url)}だけが見られます`} />;
  }
}
