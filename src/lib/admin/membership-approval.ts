import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";
import {
  type AppliedRow,
  approveMembershipRows,
  type Declaration,
  findMembershipPeriod,
  listAppliedRows,
  listDeclarationsForYear,
  listRenewalTargetTeams,
  listTeamMembershipSummary,
  type MembershipPeriod,
  type RenewalTargetTeam,
  type TeamMembershipSummary,
} from "@/lib/repo/memberships";
import { listTeamAdmins } from "@/lib/repo/teams";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";
import { periodState, type PeriodState } from "./membership-periods";

// 年度更新の締め（設計書 §5.12・§4.2 #17）。テナント管理者だけ（§3.2 manageMemberships）
// - 未申告の一覧は**対象チームだけ**（協会員の登録をするチーム・個人登録）
// - 一括承認: 代表者の申告（applied・source = renewal）を approved にし、チームの代表者に membership_approved を送る
// - 追加の申告（source = additional）は分けて出し、承認する。自動承認の年度でもここで承認する
// - 代理の申告・修正は /teams/[id]/membership を管理者が開いて行う（締切後も可）

type Admin = Principal & { userId: string };

export type TeamRow = RenewalTargetTeam & { summary: TeamMembershipSummary; declaration: Declaration | null };

export type MembershipYearView = {
  period: MembershipPeriod;
  state: PeriodState;
  // 対象チームのうち申告を送っていないもの
  undeclared: RenewalTargetTeam[];
  // 申告を送ったチーム（対象外のチームから送られた分も含めて全部）
  declared: TeamRow[];
  // 承認待ちの人数（通常の申告）
  pendingRenewals: number;
  // 追加の申告（チームごと）
  additional: { team: { id: string; name: string }; rows: AppliedRow[] }[];
};

export async function getMembershipYearForAdmin(db: Db, principal: Admin, associationId: string, year: number, now: Date = new Date()): Promise<MembershipYearView> {
  if (!Number.isInteger(year)) throw new TeamError(404, "受付が見つかりません");
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const period = await findMembershipPeriod(tx, associationId, year);
      if (!period) throw new TeamError(404, "受付が見つかりません");
      const targets = await listRenewalTargetTeams(tx, associationId);
      const declarations = await listDeclarationsForYear(tx, associationId, year);
      const summaries = await listTeamMembershipSummary(tx, associationId, year);
      const empty: TeamMembershipSummary = { applied: 0, approved: 0, declined: 0, additionalApplied: 0 };
      const declared: TeamRow[] = targets
        .filter((t) => declarations.has(t.id))
        .map((t) => ({ ...t, summary: summaries.get(t.id) ?? empty, declaration: declarations.get(t.id) ?? null }));
      const undeclared = targets.filter((t) => !declarations.has(t.id));
      const pendingRenewals = declared.reduce((n, t) => n + t.summary.applied, 0);
      const additionalRows = await listAppliedRows(tx, associationId, year, "additional");
      const byTeam = new Map<string, AppliedRow[]>();
      for (const row of additionalRows) {
        const key = row.teamId ?? "";
        byTeam.set(key, [...(byTeam.get(key) ?? []), row]);
      }
      const names = new Map(targets.map((t) => [t.id, t.name]));
      const additional = [...byTeam.entries()].map(([teamId, rows]) => ({ team: { id: teamId, name: names.get(teamId) ?? "（チームなし）" }, rows }));
      return { period, state: periodState(period, now), undeclared, declared, pendingRenewals, additional };
    },
    { userId: principal.userId },
  );
}

export type ApproveInput = { scope: "renewal" | "additional"; teamIds?: string[] };
export type ApproveResult = { approved: number; teams: number };

// 一括承認。scope = renewal は代表者の申告、additional は追加の申告。teamIds を渡せばそのチームの分だけ
export async function approveMemberships(db: Db, principal: Admin, associationId: string, year: number, raw: Record<string, unknown>, now: Date = new Date()): Promise<ApproveResult> {
  if (!Number.isInteger(year)) throw new TeamError(404, "受付が見つかりません");
  const scope = raw.scope === "additional" ? "additional" : raw.scope === "renewal" ? "renewal" : null;
  if (!scope) throw new TeamError(400, "承認する対象を選んでください");
  const teamIds = raw.teamIds === undefined ? null : Array.isArray(raw.teamIds) && raw.teamIds.every((id) => typeof id === "string" && isUuid(id)) ? new Set(raw.teamIds as string[]) : undefined;
  if (teamIds === undefined) throw new TeamError(400, "チームの選び方が正しくありません");

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const period = await findMembershipPeriod(tx, associationId, year);
      if (!period) throw new TeamError(404, "受付が見つかりません");
      const rows = (await listAppliedRows(tx, associationId, year, scope)).filter((r) => r.teamId !== null && (!teamIds || teamIds.has(r.teamId)));
      const approved = await approveMembershipRows(
        tx,
        associationId,
        rows.map((r) => r.id),
        principal.userId,
        now,
      );
      // 承認したことを、チームごとに 1 通、有効な代表者全員へ（人数だけ。氏名は載せない）
      const byTeam = new Map<string, number>();
      for (const row of rows) byTeam.set(row.teamId as string, (byTeam.get(row.teamId as string) ?? 0) + 1);
      for (const [teamId, count] of byTeam) {
        for (const admin of await listTeamAdmins(tx, associationId, teamId)) {
          await enqueueMail(tx, {
            associationId,
            mailType: "membership_approved",
            toEmail: admin.email,
            userId: admin.userId,
            params: { teamId, year, count, additional: scope === "additional" },
          });
        }
      }
      return { approved, teams: byTeam.size };
    },
    { userId: principal.userId },
  );
}
