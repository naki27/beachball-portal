import { getDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { getMembership } from "@/lib/auth/principal";
import { type AssociationLink, listAllAssociations, listMyAssociations } from "@/lib/repo/associations";
import { listTeamsAdminedBy } from "@/lib/repo/teams";
import { type Principal, ROLE_LABEL } from "@/lib/authz";

// 協会をまたぐ画面（/・/mypage・協会の切り替えメニュー）で使う、ログイン中の人の協会（設計書 §5.14）

export type MyAssociation = AssociationLink & {
  // その協会での役割の呼び名（§4.4）。例: ["協会の管理者", "チームの代表者"]
  roles: string[];
};

// 役割を持つ協会と、協会ごとの役割。役割は協会ごとに withTenant で読む（getMembership）
export async function loadMyAssociations(principal: Principal): Promise<MyAssociation[]> {
  if (!principal.userId) return [];
  const list = await listMyAssociations(getDb(), principal.userId);
  return Promise.all(
    list.map(async (association) => {
      const membership = await getMembership(principal, association.id);
      const roles: string[] = [];
      if (membership?.isAssociationAdmin) roles.push(ROLE_LABEL.association_admin);
      if (membership && membership.teamAdminOf.size > 0) roles.push(ROLE_LABEL.team_admin);
      if (membership && membership.playerOf.size > 0) roles.push(ROLE_LABEL.player);
      return { ...association, roles };
    }),
  );
}

// 協会の切り替えメニューに出す協会（§5.14「テナントの切り替え」）。役割を持つ協会だけ（運営管理者は全協会）
// 2 つ以上のときだけメニューを出すので、1 つ以下なら空にする
export async function loadSwitchableAssociations(principal: Principal): Promise<AssociationLink[]> {
  if (!principal.userId) return [];
  const db = getDb();
  const list = principal.isPlatformAdmin ? await listAllAssociations(db) : await listMyAssociations(db, principal.userId);
  return list.length >= 2 ? list : [];
}

// マイページの協会の枠: 代表者を務めるチーム（§5.3）。協会ごとに withTenant で読む（§5.14「協会をまたぐ画面」）
export async function loadAdminTeams(principal: Principal, associationId: string): Promise<{ id: string; name: string }[]> {
  if (!principal.userId) return [];
  const userId = principal.userId;
  const teams = await withTenant(associationId, (tx) => listTeamsAdminedBy(tx, associationId, userId), { userId });
  return teams.map((t) => ({ id: t.id, name: t.name }));
}
