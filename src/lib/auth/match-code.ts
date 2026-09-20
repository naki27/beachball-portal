import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loginCodes } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { codeHashMatches, hashAttemptId, hashCode, hashEmailForKey, loginCodeMaxAttempts } from "./login-code";
import { consumeRateLimits, HOUR_MS } from "./rate-limit";

// 確認番号の照合（設計書 §9.2）。ログインとメールアドレスの変更で同じ規則を使うので、ここだけに書く
// - その Cookie の試行で発行した番号とだけ照合する。直近に発行した 3 個までの未使用・未期限の番号のどれかと一致すればよい
// - 1 つの試行につき間違いは 5 回まで。超えたらその試行の番号をすべて無効にする
// - 失敗はメールアドレス単位・IP 単位でも数える（総当たり対策）
// - 応答はそろえる: 番号が違う・期限切れ・使用済み・試行がない、のどれでも同じ形（remaining だけが変わる）
// 一致した番号を使用済みにするのは呼ぶ側（ログインは同じアドレスの番号もまとめて無効にする）

export const LATEST_CODES_PER_ATTEMPT = 3;

export const VERIFY_FAILURE_LIMITS = {
  perEmailPerHour: 10,
  perIpPerHour: 30,
} as const;

export type LoginCodeRow = typeof loginCodes.$inferSelect;

export type CodeMatch = { ok: true; row: LoginCodeRow } | { ok: false; remaining: number };

export type MatchInput = {
  attemptId: string | null;
  // normalizeCodeInput 済みの 6 桁
  code: string;
  purpose: "login" | "email_change";
  // メールアドレスの変更では、その人が発行した番号だけを見る
  userId?: string;
  ip: string;
  hmacKey: string;
  now: Date;
};

export async function matchLoginCode(tx: Tx | Db, input: MatchInput): Promise<CodeMatch> {
  const maxAttempts = loginCodeMaxAttempts();
  // 試行がない場合も、同程度の時間をかけてから同じ形で返す
  if (!input.attemptId) {
    codeHashMatches(input.hmacKey, "", input.code, hashCode(input.hmacKey, "x", "000000"));
    return { ok: false, remaining: maxAttempts };
  }
  const attemptHash = hashAttemptId(input.attemptId);

  // この試行の、未使用・未期限の番号（新しい順に 3 個まで）。行をロックして同時送信の競合を防ぐ
  const candidates = await tx
    .select()
    .from(loginCodes)
    .where(
      and(
        eq(loginCodes.attemptHash, attemptHash),
        eq(loginCodes.purpose, input.purpose),
        input.userId ? eq(loginCodes.userId, input.userId) : undefined,
        isNull(loginCodes.usedAt),
        gt(loginCodes.expiresAt, input.now),
      ),
    )
    .orderBy(desc(loginCodes.createdAt))
    .limit(LATEST_CODES_PER_ATTEMPT)
    .for("update");

  const attemptsSoFar = candidates.reduce((max, row) => Math.max(max, row.attemptCount), 0);
  const matched = candidates.find((row) => codeHashMatches(input.hmacKey, input.attemptId ?? "", input.code, row.codeHash));
  if (matched) return { ok: true, row: matched };

  if (candidates.length === 0) {
    codeHashMatches(input.hmacKey, input.attemptId, input.code, hashCode(input.hmacKey, "x", "000000"));
    return { ok: false, remaining: 0 };
  }
  const attempts = attemptsSoFar + 1;
  const exhausted = attempts >= maxAttempts;
  await tx
    .update(loginCodes)
    .set({ attemptCount: attempts, ...(exhausted ? { usedAt: input.now } : {}) })
    .where(and(eq(loginCodes.attemptHash, attemptHash), isNull(loginCodes.usedAt)));
  await consumeRateLimits(
    tx,
    [
      { key: `login_verify:email:${hashEmailForKey(candidates[0].email)}`, limit: VERIFY_FAILURE_LIMITS.perEmailPerHour, windowMs: HOUR_MS },
      { key: `login_verify:ip:${input.ip}`, limit: VERIFY_FAILURE_LIMITS.perIpPerHour, windowMs: HOUR_MS },
    ],
    input.now,
  );
  return { ok: false, remaining: Math.max(0, maxAttempts - attempts) };
}
