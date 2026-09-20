import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { endOfDayTokyo, startOfDayTokyo } from "@/lib/date";
import { currentFiscalYear, type RenewalState, renewalState } from "@/lib/membership";
import { parsePeriodInput } from "@/lib/memberships/period-input";
import { findAssociationById } from "@/lib/repo/associations";
import {
  findMembershipPeriod,
  insertMembershipPeriod,
  listDeclaredTeamIds,
  listMembershipPeriods,
  type MembershipPeriod,
  updateMembershipPeriod,
} from "@/lib/repo/memberships";
import { countRenewalTargetTeams } from "@/lib/repo/teams";
import { TeamError } from "@/lib/teams/errors";
import { authorizeAssociationAdmin } from "./access";

// 年度更新の受付の管理（設計書 §5.12「受付開始」・§4.2 #17）。テナント管理者だけ（§3.2 manageMemberships）
// 受付を開始すると、対象のチーム（teams.membership_renewal_target）の代表者に案内が出る（§5.17・D-02）
// 依頼メールの一斉送信と督促は P1（§11.2 の送信数の上限に合わせる作りが要る）

type Actor = Principal & { userId: string };

export type AdminPeriodRow = MembershipPeriod & {
  state: RenewalState;
  // 対象のチームの数と、そのうち申告を送ったチームの数（未申告の一覧は D-04）
  targetTeams: number;
  declaredTeams: number;
};

export type AdminMembershipsView = {
  // 今年度（協会の年度の開始月で数える）
  currentYear: number;
  fiscalYearStartMonth: number;
  periods: AdminPeriodRow[];
};

async function startMonthOf(db: Db, associationId: string): Promise<number> {
  // associations はテナントに属さない表なので withTenant の外で読む（§5.14）
  return (await findAssociationById(db, associationId))?.fiscalYearStartMonth ?? 4;
}

async function toRow(tx: Tx, associationId: string, period: MembershipPeriod, now: Date): Promise<AdminPeriodRow> {
  const declared = await listDeclaredTeamIds(tx, associationId, period.year);
  return {
    ...period,
    state: renewalState(period, now) ?? "not_started",
    targetTeams: await countRenewalTargetTeams(tx, associationId),
    declaredTeams: declared.size,
  };
}

export async function getMembershipsForAdmin(db: Db, principal: Actor, associationId: string, now: Date = new Date()): Promise<AdminMembershipsView> {
  const startMonth = await startMonthOf(db, associationId);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const periods = await listMembershipPeriods(tx, associationId);
      const rows: AdminPeriodRow[] = [];
      for (const period of periods) rows.push(await toRow(tx, associationId, period, now));
      return { currentYear: currentFiscalYear(startMonth, now), fiscalYearStartMonth: startMonth, periods: rows };
    },
    { userId: principal.userId },
  );
}

// 受付を開始する（その年度の受付を作る）。同じ年度に 2 つは作れない
export async function openRenewalPeriod(db: Db, principal: Actor, associationId: string, raw: Record<string, unknown>): Promise<{ year: number }> {
  const parsed = parsePeriodInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  const input = parsed.value;

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const existing = await findMembershipPeriod(tx, associationId, input.year);
      if (existing) throw new TeamError(409, `${input.year}年度の受付はすでに始めています`, { field: "year" });
      await insertMembershipPeriod(tx, associationId, {
        year: input.year,
        opensAt: startOfDayTokyo(input.opensDate),
        closesAt: endOfDayTokyo(input.closesDate),
        autoApprove: input.autoApprove,
      });
      return { year: input.year };
    },
    { userId: principal.userId },
  );
}

// 受付の期間・承認の省略を直す（締切を延ばす・承認を省くのをやめる）
export async function editRenewalPeriod(db: Db, principal: Actor, associationId: string, year: number, raw: Record<string, unknown>): Promise<void> {
  const parsed = parsePeriodInput({ ...raw, year: String(year) });
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  const input = parsed.value;

  await withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const ok = await updateMembershipPeriod(tx, associationId, year, {
        opensAt: startOfDayTokyo(input.opensDate),
        closesAt: endOfDayTokyo(input.closesDate),
        autoApprove: input.autoApprove,
      });
      if (!ok) throw new TeamError(404, "その年度の受付が見つかりません");
    },
    { userId: principal.userId },
  );
}
