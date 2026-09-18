import type { Tx } from "@/db/tenant";
import { type Principal, resolveRole, roleIncludes } from "@/lib/authz";
import { readAssociationRoles } from "@/lib/repo/roles";
import { TeamError } from "@/lib/teams/errors";

// 協会の管理画面（/[スラッグ]/admin/…・/api/[スラッグ]/admin/…）の入口。テナント管理者（と切り替えて入った運営管理者）だけ（§3.2）
// withTenant の tx の中で呼ぶ。権限がなければ 403
export async function authorizeAssociationAdmin(tx: Tx, principal: Principal & { userId: string }, associationId: string): Promise<void> {
  const roles = await readAssociationRoles(tx, associationId, principal.userId);
  const role = resolveRole(principal, roles, { associationId });
  if (!roleIncludes(role, "association_admin")) throw new TeamError(403, "協会の管理者だけができます");
}
