import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { can, type Principal, resolveRole } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { normalizeName } from "@/lib/normalize";
import { readAssociationRoles } from "@/lib/repo/roles";
import { addTeamAdmin, createTeam, findTeam, listTeamNames, listTeamsAdminedBy, type Team, updateTeam } from "@/lib/repo/teams";
import { parseTeamInput, type TeamInput } from "./team-input";

// チームの作成と代表者・チーム情報の編集（設計書 §5.11「チームの作り方」・§5.15）

export type SameNameInfo = {
  // 同じ名前（正規化して比べる）のチームの数。名前は参加チーム名として公開される情報なので数を知らせてよい
  count: number;
  // そのうち自分が代表者を務めるチーム（誤って新規作成するのを防ぐため、リンクを出す）
  mine: { id: string; name: string }[];
};

export class TeamError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// 同名のチーム。表記の揺れ（全角・半角、空白、大文字・小文字、ひらがな・カタカナ）は normalize.ts で吸収する
export async function findSameNameTeams(db: Db, associationId: string, userId: string, name: string): Promise<SameNameInfo> {
  const key = normalizeName(name);
  if (!key) return { count: 0, mine: [] };
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const same = (await listTeamNames(tx, associationId)).filter((t) => normalizeName(t.name) === key);
      if (same.length === 0) return { count: 0, mine: [] };
      const mineIds = new Set((await listTeamsAdminedBy(tx, associationId, userId)).map((t) => t.id));
      return { count: same.length, mine: same.filter((t) => mineIds.has(t.id)) };
    },
    { userId },
  );
}

// 「チームで登録」（§5.11）。ログインした人なら誰でも・承認なしで作れ、作った人が代表者（team_admins・granted_by NULL）になる
// 同名のチームがあれば 409（sameName）で知らせる。利用者が「別のチームとして登録する」を選んだら confirmSameName で作る
export async function registerTeam(
  db: Db,
  associationId: string,
  userId: string,
  input: TeamInput,
  options: { confirmSameName?: boolean } = {},
): Promise<Team> {
  if (!options.confirmSameName) {
    const sameName = await findSameNameTeams(db, associationId, userId, input.name);
    if (sameName.count > 0) throw new TeamError(409, "同じ名前のチームがあります", { sameName });
  }
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const team = await createTeam(tx, associationId, { ...input, kind: "team", createdBy: userId });
      await addTeamAdmin(tx, associationId, team.id, userId, null);
      return team;
    },
    { userId },
  );
}

// チーム情報の編集。URL の協会にそのチームがなければ 404、代表者（またはテナント管理者）でなければ 403、
// 入力の誤りは 400（§3.1 の順: 資源 → 権限 → 入力）。raw は API の本文
export async function editTeam(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  raw: Record<string, unknown>,
): Promise<Team> {
  if (!isUuid(teamId)) throw new TeamError(404, "チームが見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const team = await findTeam(tx, associationId, teamId);
      if (!team) throw new TeamError(404, "チームが見つかりません");
      const roles = await readAssociationRoles(tx, associationId, principal.userId);
      const role = resolveRole(principal, roles, { associationId, teamId });
      if (!can(role, "editTeam")) throw new TeamError(403, "チームの代表者だけが変えられます");
      const parsed = parseTeamInput(raw);
      if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
      const updated = await updateTeam(tx, associationId, teamId, parsed.value);
      if (!updated) throw new TeamError(404, "チームが見つかりません");
      return updated;
    },
    { userId: principal.userId },
  );
}
