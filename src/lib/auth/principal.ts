import { and, eq, inArray, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { cache } from "react";
import { getDb } from "@/db/client";
import { associationAdmins, members, platformAdmins, teamAdmins, teamMembers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { ANONYMOUS, type AssociationMembership, type Principal } from "@/lib/authz";
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
    return withTenant(
      associationId,
      async (tx) => {
        const [admin] = await tx
          .select({ userId: associationAdmins.userId })
          .from(associationAdmins)
          .where(and(eq(associationAdmins.associationId, associationId), eq(associationAdmins.userId, userId)))
          .limit(1);

        const adminOf = await tx
          .select({ teamId: teamAdmins.teamId })
          .from(teamAdmins)
          .where(and(eq(teamAdmins.associationId, associationId), eq(teamAdmins.userId, userId), isNull(teamAdmins.revokedAt)));

        // 自分の人物（members.user_id）が現役の選手として載っているチーム（left_at・deleted_at が NULL・§3.2）
        const own = await tx
          .select({ id: members.id })
          .from(members)
          .where(and(eq(members.associationId, associationId), eq(members.userId, userId), isNull(members.deletedAt)));
        const playerOf =
          own.length === 0
            ? []
            : await tx
                .select({ teamId: teamMembers.teamId })
                .from(teamMembers)
                .where(
                  and(
                    eq(teamMembers.associationId, associationId),
                    inArray(
                      teamMembers.memberId,
                      own.map((m) => m.id),
                    ),
                    isNull(teamMembers.leftAt),
                    isNull(teamMembers.deletedAt),
                  ),
                );

        return {
          associationId,
          isAssociationAdmin: !!admin,
          teamAdminOf: new Set(adminOf.map((r) => r.teamId)),
          playerOf: new Set(playerOf.map((r) => r.teamId)),
        };
      },
      { userId },
    );
  },
);
