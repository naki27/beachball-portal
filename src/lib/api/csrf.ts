// CSRF 対策（設計書 §9.2）: SameSite=Lax の Cookie に加えて、POST の Origin ヘッダを検査する
// 比べる相手は Host ヘッダ（Cloud Run などの前段があれば x-forwarded-host）。request.url は dev サーバーが
// 設定上のホスト名（localhost）に書き換えることがあり、127.0.0.1 で開いたブラウザと食い違うため使わない
// Origin がないリクエスト（古いブラウザ・同一オリジンの一部の送信）は Referer を見る。どちらもなければ拒否

export function isSameOrigin(request: Request): boolean {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  if (!origin) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
