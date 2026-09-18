import type { Tx } from "@/db/tenant";
import { ACTIONS, type Action, can, type Principal, resolveRole, ROLE_LABEL, type Role } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { readAssociationRoles } from "@/lib/repo/roles";
import { findTeam, type Team } from "@/lib/repo/teams";
import { TeamError } from "./errors";

export type TeamAccess = { team: Team; role: Role };

// チームに対する操作の入口（§3.1 の順: 資源 → 権限）。withTenant の tx の中で呼ぶ
// URL の協会にそのチームがない（ほかの協会のチーム ID・削除済み・ID の形が違う）→ 404 ／ 権限がない → 403
export async function authorizeTeam(
  tx: Tx,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  action: Action,
): Promise<TeamAccess> {
  if (!isUuid(teamId)) throw new TeamError(404, "チームが見つかりません");
  const team = await findTeam(tx, associationId, teamId);
  if (!team) throw new TeamError(404, "チームが見つかりません");
  const roles = await readAssociationRoles(tx, associationId, principal.userId);
  const role = resolveRole(principal, roles, { associationId, teamId });
  if (!can(role, action)) throw new TeamError(403, `${ROLE_LABEL[ACTIONS[action].minRole]}だけができます`);
  return { team, role };
}
