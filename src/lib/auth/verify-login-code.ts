import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loginCodes, sessions, users } from "@/db/schema";
import { requireEnv } from "@/db/env";
import { codeHashMatches, hashAttemptId, hashCode, hashEmailForKey, loginCodeMaxAttempts } from "./login-code";
import { consumeRateLimits, HOUR_MS } from "./rate-limit";
import { ADMIN_IDLE_TAKEOVER_MS, activeSessionsOf, createSession, type CreatedSession } from "./session";

// 確認番号の照合（設計書 §9.1・§9.2・§5.1）
// - その Cookie の試行で発行した番号とだけ照合する。直近に発行した 3 個までの未使用・未期限の番号のどれかと一致すればよい
// - 1 つの試行につき間違いは 5 回まで。超えたら試行の番号をすべて無効にする
// - 一致したら users がなければ作る（同意の版と日時を保存）
// - テナント管理者（どこかの協会の association_admins にいる人）は同時に 1 つのセッションまで（§9.2）:
//   別の有効なセッションの最後の操作が 30 分以内なら 409 で断る（番号は使用済みにしない）。30 分以上たっていれば終了して受け付ける
// - 受け付けたら、そのメールアドレスの他の番号もすべて無効にしてセッションを作る
// - 応答はそろえる: 番号が違う・期限切れ・使用済み・試行がない、のどれでも同じ結果（remaining だけが変わる）

export const LATEST_CODES_PER_ATTEMPT = 3;

export const VERIFY_FAILURE_LIMITS = {
  perEmailPerHour: 10,
  perIpPerHour: 30,
} as const;

export type VerifyInput = {
  attemptId: string | null;
  code: string; // normalizeCodeInput 済みの 6 桁
  ip: string;
  termsVersion: string;
  now?: Date;
};

export type VerifyResult =
  | { ok: true; userId: string; email: string; isNewUser: boolean; session: CreatedSession }
  // remaining = この試行であと何回間違えられるか（0 なら番号をすべて無効にした）
  | { ok: false; reason: "invalid"; remaining: number }
  // テナント管理者が別の端末でログイン中（番号はそのまま使える）
  | { ok: false; reason: "admin_session_exists" };

export async function verifyLoginCode(db: Db, input: VerifyInput): Promise<VerifyResult> {
  const now = input.now ?? new Date();
  const hmacKey = requireEnv("LOGIN_CODE_HMAC_KEY");
  const maxAttempts = loginCodeMaxAttempts();

  return db.transaction(async (tx) => {
    // 試行がない場合も、同程度の時間をかけてから同じ形で返す
    const attemptId = input.attemptId;
    if (!attemptId) {
      codeHashMatches(hmacKey, "", input.code, hashCode(hmacKey, "x", "000000"));
      return { ok: false, reason: "invalid", remaining: maxAttempts };
    }
    const attemptHash = hashAttemptId(attemptId);

    // この試行の、未使用・未期限の番号（新しい順に 3 個まで）。行をロックして同時送信の競合を防ぐ
    const candidates = await tx
      .select()
      .from(loginCodes)
      .where(
        and(
          eq(loginCodes.attemptHash, attemptHash),
          eq(loginCodes.purpose, "login"),
          isNull(loginCodes.usedAt),
          gt(loginCodes.expiresAt, now),
        ),
      )
      .orderBy(desc(loginCodes.createdAt))
      .limit(LATEST_CODES_PER_ATTEMPT)
      .for("update");

    const attemptsSoFar = candidates.reduce((max, row) => Math.max(max, row.attemptCount), 0);
    const matched = candidates.find((row) => codeHashMatches(hmacKey, attemptId, input.code, row.codeHash));

    if (!matched) {
      if (candidates.length === 0) {
        codeHashMatches(hmacKey, attemptId, input.code, hashCode(hmacKey, "x", "000000"));
        return { ok: false, reason: "invalid", remaining: 0 };
      }
      const attempts = attemptsSoFar + 1;
      const exhausted = attempts >= maxAttempts;
      await tx
        .update(loginCodes)
        .set({ attemptCount: attempts, ...(exhausted ? { usedAt: now } : {}) })
        .where(and(eq(loginCodes.attemptHash, attemptHash), isNull(loginCodes.usedAt)));
      // 照合の失敗もメールアドレス単位・IP 単位で数える（総当たり対策・§9.2）
      await consumeRateLimits(
        tx,
        [
          { key: `login_verify:email:${hashEmailForKey(candidates[0].email)}`, limit: VERIFY_FAILURE_LIMITS.perEmailPerHour, windowMs: HOUR_MS },
          { key: `login_verify:ip:${input.ip}`, limit: VERIFY_FAILURE_LIMITS.perIpPerHour, windowMs: HOUR_MS },
        ],
        now,
      );
      return { ok: false, reason: "invalid", remaining: Math.max(0, maxAttempts - attempts) };
    }

    // users がなければ作る（§5.1）。あれば確認済みと最終ログインを更新
    const [existing] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, matched.email), isNull(users.deletedAt)))
      .limit(1);
    let userId: string;
    let isNewUser = false;
    if (existing) {
      userId = existing.id;
    } else {
      const [created] = await tx
        .insert(users)
        .values({ email: matched.email, emailVerifiedAt: now, termsVersion: input.termsVersion, termsAcceptedAt: now })
        .returning({ id: users.id });
      userId = created.id;
      isNewUser = true;
    }

    // テナント管理者の同時ログインの制限（§9.2）。2 つのログインが同時に来ても両方は通らないよう、ユーザーの行をロックする
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    const [{ admin }] = (await tx.execute<{ admin: boolean }>(sql`select current_user_is_association_admin() as admin`)).rows;
    if (admin) {
      await tx.execute(sql`select 1 from users where id = ${userId} for update`);
      const active = await activeSessionsOf(tx, userId, now);
      const recent = active.filter((s) => now.getTime() - s.lastSeenAt.getTime() < ADMIN_IDLE_TAKEOVER_MS);
      if (recent.length > 0) return { ok: false, reason: "admin_session_exists" };
      // 最後の操作から 30 分以上たったセッションは終了して受け付ける（ログアウトし忘れの逃げ道）
      if (active.length > 0) {
        await tx.delete(sessions).where(
          inArray(
            sessions.id,
            active.map((s) => s.id),
          ),
        );
      }
    }

    // ここで初めて番号を使用済みにし、同じメールアドレスの他の番号もすべて無効にする
    await tx
      .update(loginCodes)
      .set({ usedAt: now })
      .where(and(eq(loginCodes.email, matched.email), isNull(loginCodes.usedAt)));
    await tx
      .update(users)
      .set({ lastLoginAt: now, emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now})`, updatedAt: now })
      .where(eq(users.id, userId));

    const session = await createSession(tx, userId, now);
    return { ok: true, userId, email: matched.email, isNewUser, session };
  });
}
