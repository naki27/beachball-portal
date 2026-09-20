import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { endOfDayTokyo, startOfDayTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";
import { currentFiscalYear, type RenewalState, renewalState } from "@/lib/membership";
import { submitDeclaration, type SubmitDeclarationResult } from "@/lib/memberships/declaration";
import { parsePeriodInput } from "@/lib/memberships/period-input";
import { findAssociationById } from "@/lib/repo/associations";
import {
  approveMemberships,
  findMembershipPeriod,
  insertMembershipPeriod,
  listDeclaredTeamIds,
  listMembershipPeriods,
  listMembershipsForYear,
  type MembershipPeriod,
  type MembershipRow,
  updateMembershipPeriod,
} from "@/lib/repo/memberships";
import { listActiveRoster } from "@/lib/repo/team-members";
import { countRenewalTargetTeams, listRenewalTargetTeams, listTeamAdmins } from "@/lib/repo/teams";
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

// ここから D-04: 未申告の一覧・承認・代理の申告・追加の申告

export type PendingTeam = {
  teamId: string | null;
  teamName: string;
  // 承認待ちの人（氏名だけ。生年月日は出さない）
  players: { memberId: string; name: string }[];
};

export type UndeclaredTeam = { teamId: string; teamName: string; players: number };

export type RenewalStatusView = {
  year: number;
  state: RenewalState | null;
  autoApprove: boolean;
  closesAt: Date | null;
  // 対象のチームのうち、まだ申告を送っていないもの（対象のチームだけ・§5.12）
  undeclared: UndeclaredTeam[];
  // 通常の申告の承認待ち（チームごと）
  pending: PendingTeam[];
  // 年度の途中の追加の申告（分けて出す・§5.12）
  additional: PendingTeam[];
  approvedCount: number;
};

function groupByTeam(rows: readonly MembershipRow[]): PendingTeam[] {
  const groups = new Map<string, PendingTeam>();
  for (const row of rows) {
    const key = row.teamId ?? "";
    const group = groups.get(key) ?? { teamId: row.teamId, teamName: row.teamName ?? "チームなし", players: [] };
    group.players.push({ memberId: row.memberId, name: row.memberName });
    groups.set(key, group);
  }
  return [...groups.values()];
}

export async function getRenewalStatusForAdmin(
  db: Db,
  principal: Actor,
  associationId: string,
  year: number,
  now: Date = new Date(),
): Promise<RenewalStatusView> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      const period = await findMembershipPeriod(tx, associationId, year);
      const declared = await listDeclaredTeamIds(tx, associationId, year);
      const targets = await listRenewalTargetTeams(tx, associationId);
      const rows = await listMembershipsForYear(tx, associationId, year, ["applied", "approved"]);
      const applied = rows.filter((row) => row.status === "applied");

      const undeclared: UndeclaredTeam[] = [];
      for (const team of targets) {
        if (declared.has(team.id)) continue;
        undeclared.push({ teamId: team.id, teamName: team.name, players: (await listActiveRoster(tx, associationId, team.id)).length });
      }

      return {
        year,
        state: renewalState(period, now),
        autoApprove: period?.autoApprove ?? false,
        closesAt: period?.closesAt ?? null,
        undeclared,
        pending: groupByTeam(applied.filter((row) => row.source !== "additional")),
        additional: groupByTeam(applied.filter((row) => row.source === "additional")),
        approvedCount: rows.filter((row) => row.status === "approved").length,
      };
    },
    { userId: principal.userId },
  );
}

// 承認（§5.12）。applied の人だけが approved になる。承認のお知らせをチームの代表者に積む
export async function approveDeclarations(
  db: Db,
  principal: Actor,
  associationId: string,
  year: number,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ approved: number }> {
  const memberIds = Array.isArray(raw.memberIds) ? raw.memberIds.filter((id): id is string => typeof id === "string") : [];
  if (memberIds.length === 0) throw new TeamError(400, "承認する人を選んでください", { field: "memberIds" });
  if (memberIds.some((id) => !isUuid(id))) throw new TeamError(400, "承認する人を選んでください", { field: "memberIds" });

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeAssociationAdmin(tx, principal, associationId);
      // どのチームに知らせるかを、承認する前に読む
      const before = await listMembershipsForYear(tx, associationId, year, ["applied"]);
      const target = before.filter((row) => memberIds.includes(row.memberId));
      const approved = await approveMemberships(tx, associationId, year, memberIds, principal.userId, now);

      // 承認のお知らせ（§11 の membership_approved）。チームごとに 1 通ずつ、有効な代表者全員へ
      const teamIds = [...new Set(target.map((row) => row.teamId).filter((id): id is string => !!id))];
      for (const teamId of teamIds) {
        for (const admin of await listTeamAdmins(tx, associationId, teamId)) {
          await enqueueMail(tx, {
            associationId,
            mailType: "membership_approved",
            toEmail: admin.email,
            userId: admin.userId,
            params: { teamId, year },
          });
        }
      }
      return { approved };
    },
    { userId: principal.userId },
  );
}

// 運営の代理の申告・修正（§5.12）。締切後も直せる。中身の規則は代表者と同じ（declaration.ts）
export async function declareForTeamAsAdmin(
  db: Db,
  principal: Actor,
  associationId: string,
  teamId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<SubmitDeclarationResult> {
  return submitDeclaration(db, principal, associationId, teamId, raw, now, { asAdmin: true });
}
