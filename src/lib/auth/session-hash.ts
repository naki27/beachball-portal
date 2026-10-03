import { createHash } from "node:crypto";

// セッションのハッシュ（Cookie の乱数 ID → DB の sessions.session_hash）。設計書 §9.2
// session.ts から切り出してある。proxy（操作ログ）が drizzle や DB のスキーマを読み込まずに
// 同じハッシュを作れるようにするため。実装はここ 1 か所

export function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}
