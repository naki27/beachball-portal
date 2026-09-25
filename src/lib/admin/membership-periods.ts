import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { endOfDayTokyo, startOfDayTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { parsePeriodInput } from "@/lib/memberships/period-input";
import {
  findMembershipPeriod,
  findMembershipPeriodById,
  insertMembershipPeriod,
  listDeclaredTeamIds,
  listMembershipPeriods,
  listRenewalTargetTeams,
  type MembershipPeriod,
  updateMembershipPeriod,
} from "@/lib/repo/memberships";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// 年度更新の受付（設計書 §5.12「受付開始」）。テナント管理者（と切り替えて入った運営管理者）だけ（§3.2 manageMemberships）
// 対象年度・受付期間・承認を省くかを決めて受付を開始する。開始はその日の 0:00、締切はその日の 23:59:59（日本時間）

export type PeriodState = "before" | "open" | "closed";

export type AdminPeriodRow = MembershipPeriod & {
  state: PeriodState;
  // 年度更新の対象チーム（協会員の登録をするチーム＋個人登録）の数と、そのうち申告を送った数
  targetTeams: number;
  declaredTeams: number;
};

type Admin = Principal & { userId: string };

export function periodState(period: Pick<MembershipPeriod, "opensAt" | "closesAt">, now: Date): PeriodState {
  if (now.getTime() < period.opensAt.getTime()) return "before";
  if (now.getTime() > period.closesAt.getTime()) return "closed";
  return "open";
}

export async function listMembershipPeriodsForAdmin(db: Db, principal: Admin, associationId: string, now: Date = new Date()): Promise<AdminPeriodRow[]> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const periods = await listMembershipPeriods(tx, associationId);
      if (periods.length === 0) return [];
      const targets = await listRenewalTargetTeams(tx, associationId);
      const targetIds = new Set(targets.map((t) => t.id));
      const rows: AdminPeriodRow[] = [];
      for (const period of periods) {
        const declared = await listDeclaredTeamIds(tx, associationId, period.year);
        rows.push({
          ...period,
          state: periodState(period, now),
          targetTeams: targets.length,
          declaredTeams: [...declared].filter((id) => targetIds.has(id)).length,
        });
      }
      return rows;
    },
    { userId: principal.userId },
  );
}

// 受付を開始する。同じ年度の受付は 1 つだけ（409）
export async function openMembershipPeriod(db: Db, principal: Admin, associationId: string, raw: Record<string, unknown>): Promise<MembershipPeriod> {
  const parsed = parsePeriodInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      if (await findMembershipPeriod(tx, associationId, parsed.value.year)) {
        throw new TeamError(409, `${parsed.value.year}年度の受付はすでにあります。期間を変えるときは一覧から直してください`, { field: "year" });
      }
      return insertMembershipPeriod(tx, associationId, {
        year: parsed.value.year,
        opensAt: startOfDayTokyo(parsed.value.opensDate),
        closesAt: endOfDayTokyo(parsed.value.closesDate),
        autoApprove: parsed.value.autoApprove,
      });
    },
    { userId: principal.userId },
  );
}

// 受付期間と承認の設定を直す。年度は変えられない
export async function editMembershipPeriod(
  db: Db,
  principal: Admin,
  associationId: string,
  periodId: string,
  raw: Record<string, unknown>,
): Promise<MembershipPeriod> {
  if (!isUuid(periodId)) throw new TeamError(404, "受付が見つかりません");
  const parsed = parsePeriodInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const current = await findMembershipPeriodById(tx, associationId, periodId);
      if (!current) throw new TeamError(404, "受付が見つかりません");
      if (current.year !== parsed.value.year) throw new TeamError(409, "対象年度は変えられません。別の年度は新しく受付を開始してください", { field: "year" });
      const updated = await updateMembershipPeriod(tx, associationId, periodId, {
        opensAt: startOfDayTokyo(parsed.value.opensDate),
        closesAt: endOfDayTokyo(parsed.value.closesDate),
        autoApprove: parsed.value.autoApprove,
      });
      if (!updated) throw new TeamError(404, "受付が見つかりません");
      return updated;
    },
    { userId: principal.userId },
  );
}
