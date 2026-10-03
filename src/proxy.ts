import { type NextRequest, NextResponse } from "next/server";
import { recordRequest } from "@/lib/access-log";

// すべてのページと API の前で動く。DB には触らない（協会の解決は src/lib/resolve-association.ts）
// - x-url: サーバーコンポーネント（layout・エラーページ）が元の URL（パスと検索文字列）を知るため。
//   旧スラッグの 308 と、「協会のトップへ戻る」の行き先に使う。利用者が送ってきた値は上書きする
// - 操作ログ: 誰がどの画面で何をしたか（リクエストだけ）を 1 行ずつ残す（src/lib/access-log・docs/adr/0027）
export function proxy(request: NextRequest): NextResponse {
  recordRequest(request);
  const headers = new Headers(request.headers);
  headers.set("x-url", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
