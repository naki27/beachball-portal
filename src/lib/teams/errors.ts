// チーム・選手一覧の処理の誤り（設計書 §3.1 の判定規則）。API は jsonError に、画面は notFound() / forbidden() にする
// 400 = 入力の形が違う ／ 403 = 権限がない ／ 404 = URL の協会にその資源がない ／ 409 = 業務上の条件で受け付けない
export class TeamError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
