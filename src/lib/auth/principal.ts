import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { getDb } from "@/db/client";
import { platformAdmins } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { ANONYMOUS, type AssociationMembership, type Principal } from "@/lib/authz";
import { readAssociationRoles } from "@/lib/repo/roles";
import { sessionCookieName } from "./cookies";
import { loadSession } from "./session";

// ログイン中の人（設計書 §9.2）。Cookie のセッション ID → sessions → users。同じリクエストの中では 1 回だけ読む
// Cookie はあるがセッションが切れていれば sessionState = "expired"（403 の文言を分ける・§3.1）
export const getPrincipal = cache(async (): Promise<Principal> => {
  const jar = await cookies();
  const sessionId = jar.get(sessionCookieName())?.value;
  if (!sessionId) return ANONYMOUS;

  const db = getDb();
  const session = await loadSession(db, sessionId);
  if (!session) return { ...ANONYMOUS, sessionState: "expired" };

  const [platformAdmin] = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, session.userId))
    .limit(1);
  const entered =
    session.enteredAssociationId && session.enteredUntil && session.enteredUntil.getTime() > Date.now()
      ? session.enteredAssociationId
      : null;

  return {
    userId: session.userId,
    sessionState: "active",
    isPlatformAdmin: !!platformAdmin,
    enteredAssociationId: entered,
    mfaVerifiedAt: session.mfaVerifiedAt,
  };
});

// その協会で持っている役割の行（§3.1）。テナントの表なので withTenant の中で読む
export const getMembership = cache(
  async (principal: Principal, associationId: string): Promise<AssociationMembership | null> => {
    if (!principal.userId) return null;
    const userId = principal.userId;
    return withTenant(associationId, (tx) => readAssociationRoles(tx, associationId, userId), { userId });
  },
);
