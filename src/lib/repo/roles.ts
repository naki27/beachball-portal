import { and, eq, inArray, isNull } from "drizzle-orm";
import { associationAdmins, members, teamAdmins, teamMembers } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import type { AssociationMembership } from "@/lib/authz";

// その協会で持っている役割の行（§3.1）。withTenant の tx の中で呼ぶ
// 協会の管理者（association_admins）・代表者（team_admins の revoked_at が NULL）・
// 選手（自分の人物 members.user_id が現役で載っている team_members。left_at・deleted_at が NULL・§3.2）
export async function readAssociationRoles(tx: Tx, associationId: string, userId: string): Promise<AssociationMembership> {
  const [admin] = await tx
    .select({ userId: associationAdmins.userId })
    .from(associationAdmins)
    .where(and(eq(associationAdmins.associationId, associationId), eq(associationAdmins.userId, userId)))
    .limit(1);

  const adminOf = await tx
    .select({ teamId: teamAdmins.teamId })
    .from(teamAdmins)
    .where(and(eq(teamAdmins.associationId, associationId), eq(teamAdmins.userId, userId), isNull(teamAdmins.revokedAt)));

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
}
