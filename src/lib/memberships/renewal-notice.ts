import { getDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { currentFiscalYear, renewalState } from "@/lib/membership";
import { findAssociationById } from "@/lib/repo/associations";
import { findMembershipPeriod, listDeclaredTeamIds } from "@/lib/repo/memberships";
import { listTeamsAdminedBy } from "@/lib/repo/teams";
import { deadlineText } from "@/lib/tournaments/deadline-text";

// 年度更新の案内（設計書 §5.12「受付開始」・§5.17「あなたのやること」・D-02）
// **協会員の登録をするチーム（teams.membership_renewal_target）の代表者にだけ**出す。
// 大会ごとに作る寄せ集めのチームには出さない。受付期間中（開始後・締切前）だけ出す

export type RenewalNotice = {
  year: number;
  teamId: string;
  teamName: string;
  // その年度の申告を送ったか（membership_declarations に行があるか）
  declared: boolean;
  closesAt: Date;
};

// その協会で、自分が代表者を務める対象のチームの案内。受付がなければ空
export async function loadRenewalNotices(
  principal: Principal,
  associationId: string,
  now: Date = new Date(),
): Promise<RenewalNotice[]> {
  if (!principal.userId) return [];
  const userId = principal.userId;
  // associations はテナントに属さない表なので withTenant の外で読む（§5.14）
  const startMonth = (await findAssociationById(getDb(), associationId))?.fiscalYearStartMonth ?? 4;
  const year = currentFiscalYear(startMonth, now);

  return withTenant(
    associationId,
    async (tx) => {
      const period = await findMembershipPeriod(tx, associationId, year);
      // 受付の開始前・締切後は案内を出さない（締切後の追加の申告の案内は D-04）
      if (renewalState(period, now) !== "open" || !period) return [];
      const teams = (await listTeamsAdminedBy(tx, associationId, userId)).filter(
        (team) => team.membershipRenewalTarget && team.status === "active",
      );
      if (teams.length === 0) return [];
      const declared = await listDeclaredTeamIds(tx, associationId, year);
      return teams.map((team) => ({
        year,
        teamId: team.id,
        teamName: team.name,
        declared: declared.has(team.id),
        closesAt: period.closesAt,
      }));
    },
    { userId },
  );
}

// 「2027年度も登録する人を選んでください（6月30日（水）まで　あと5日）」（§4.4）
export function renewalNoticeText(notice: RenewalNotice, now: Date = new Date()): string {
  if (notice.declared) return `${notice.year}年度の協会員の申告を送りました`;
  return `${notice.year}年度も登録する人を選んでください（${deadlineText(notice.closesAt, now)}）`;
}
