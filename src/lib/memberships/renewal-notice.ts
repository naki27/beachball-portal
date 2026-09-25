import type { TeamKind } from "@/db/schema";
import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { findOpenMembershipPeriod, isRenewalTarget, listDeclaredTeamIds, type MembershipPeriod } from "@/lib/repo/memberships";
import { listTeamsAdminedBy } from "@/lib/repo/teams";
import { deadlineText } from "@/lib/tournaments/deadline-text";
import { fiscalYearLabel } from "./period-input";

// 年度更新の案内（設計書 §5.12「受付開始」・§5.17「あなたのやること」）
// 受付中（開始 ≦ now ≦ 締切）の年度があるとき、**対象のチーム**（協会員の登録をするチーム・個人登録）の代表者にだけ出す
// 対象でないチームには出さない（大会ごとに作る寄せ集めチームにまで届かないように）

export type RenewalNotice = {
  teamId: string;
  teamName: string;
  kind: TeamKind;
  year: number;
  closesAt: Date;
  // その年度の申告を送ったか（締切までは直せる）
  declared: boolean;
};

// トップの「あなたのやること」用。自分が代表を務める対象チームと個人登録の分
export async function listRenewalNotices(db: Db, principal: Principal, associationId: string, now: Date = new Date()): Promise<RenewalNotice[]> {
  if (!principal.userId) return [];
  const userId = principal.userId;
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const period = await findOpenMembershipPeriod(tx, associationId, now);
      if (!period) return [];
      const teams = (await listTeamsAdminedBy(tx, associationId, userId)).filter(isRenewalTarget);
      if (teams.length === 0) return [];
      const declared = await listDeclaredTeamIds(tx, associationId, period.year);
      return teams.map((team) => ({
        teamId: team.id,
        teamName: team.name,
        kind: team.kind,
        year: period.year,
        closesAt: period.closesAt,
        declared: declared.has(team.id),
      }));
    },
    { userId },
  );
}

// 文言（§4.4: 「2027年度も登録する人を選んでください（6月30日（水）まで　あと5日）」）
export function renewalNoticeText(notice: Pick<RenewalNotice, "year" | "closesAt" | "declared">, now: Date): string {
  const deadline = deadlineText(notice.closesAt, now);
  return notice.declared
    ? `${fiscalYearLabel(notice.year)}の協会員の申告を送りました（${deadline}は直せます）`
    : `${fiscalYearLabel(notice.year)}も登録する人を選んでください（${deadline}）`;
}

export function renewalHref(slug: string, teamId: string): string {
  return `/${slug}/teams/${teamId}/membership`;
}

export type RenewalTodo = { key: string; text: string; href: string };

export function renewalTodos(slug: string, notices: RenewalNotice[], now: Date): RenewalTodo[] {
  return notices.map((notice) => ({
    key: `membership-${notice.teamId}`,
    text: notice.kind === "individual" ? renewalNoticeText(notice, now) : `${notice.teamName}: ${renewalNoticeText(notice, now)}`,
    href: renewalHref(slug, notice.teamId),
  }));
}

// チームのページ用。対象でない・受付中でない・削除済み・無効なら null
export async function getTeamRenewalNotice(
  db: Db,
  associationId: string,
  team: { id: string; name: string; kind: TeamKind; membershipRenewalTarget: boolean; status: string; deletedAt: Date | null },
  now: Date = new Date(),
): Promise<(RenewalNotice & { period: MembershipPeriod }) | null> {
  if (!isRenewalTarget(team)) return null;
  return withTenantOn(db, associationId, async (tx) => {
    const period = await findOpenMembershipPeriod(tx, associationId, now);
    if (!period) return null;
    const declared = await listDeclaredTeamIds(tx, associationId, period.year);
    return { teamId: team.id, teamName: team.name, kind: team.kind, year: period.year, closesAt: period.closesAt, declared: declared.has(team.id), period };
  });
}
