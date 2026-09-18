// API（Route Handler）のエラー応答（設計書 §3.1 の判定規則）。内部の用語・スタックは返さない
// 400 = 入力の形が違う／ 403 = 権限がない（未ログインも）／ 404 = 資源がない・URL の協会と資源の協会が違う／
// 409 = 締切後・定員など業務上の条件／ 429 = 回数の上限

export type ApiErrorStatus = 400 | 403 | 404 | 409 | 429 | 500;

export function jsonError(status: ApiErrorStatus, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: { status, message, ...extra } }, { status, headers: { "cache-control": "no-store" } });
}
