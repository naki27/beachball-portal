import { notFound } from "next/navigation";
import { withTenant } from "@/db/tenant";
import { getMembership, getPrincipal } from "@/lib/auth/principal";
import { type Action, checkAccess, type Principal, resolveRole, type Role } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import type { Association } from "@/lib/repo/associations";
import { findTeam, type Team } from "@/lib/repo/teams";
import { assertAccessOrDeny } from "./forbidden";

// チームの画面（/[slug]/teams/[teamId]/…）が最初に呼ぶ。判定の順は §3.1:
// URL の協会にそのチームがない（ほかの協会のチーム ID・削除済みを含む）→ 404 ／ 権限がない（未ログインも）→ 403
export async function requireTeam(
  association: Association,
  teamId: string,
  action: Action,
): Promise<{ team: Team; role: Role; principal: Principal }> {
  if (!isUuid(teamId)) notFound();
  const team = await withTenant(association.id, (tx) => findTeam(tx, association.id, teamId));
  if (!team) notFound();
  const principal = await getPrincipal();
  const membership = await getMembership(principal, association.id);
  const role = resolveRole(principal, membership, { associationId: association.id, teamId: team.id });
  assertAccessOrDeny(checkAccess(role, action, principal));
  return { team, role, principal };
}
