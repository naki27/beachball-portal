import type { MembershipStatus, TeamKind } from "@/db/schema";
import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { periodState } from "@/lib/admin/membership-periods";
import { type Principal, roleIncludes } from "@/lib/authz";
import { endOfDayTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";
import { fiscalYearEndOf, isApproved } from "@/lib/membership";
import { findAssociationById } from "@/lib/repo/associations";
import {
  findDeclaration,
  findOpenMembershipPeriod,
  insertMembership,
  isRenewalTarget,
  listMembershipPeriods,
  listMembershipRows,
  type MembershipPeriod,
  updateMembership,
  upsertDeclaration,
} from "@/lib/repo/memberships";
import { listActiveRoster } from "@/lib/repo/team-members";
import { listTeamAdmins } from "@/lib/repo/teams";
import { authorizeTeam } from "@/lib/teams/access";
import { TeamError } from "@/lib/teams/errors";

// 年度更新の申告（設計書 §5.12「申告フロー」「年度の途中の追加の申告」）
// - 受付期間中（renewal）: チェックを入れた人は applied（承認を省く年度は approved）。外した人は当年度が applied/approved なら
//   declined、行がなく昨年度の会員なら declined を作る。変えていない人はそのまま。何度でも直せる
// - 締切後〜年度末（additional）: **会員を増やすことだけ**。入れた人は applied（source = additional）。承認を省く年度でも承認が要る。
//   外すのは運営に依頼する（チェックを外しても変えない）
// - 年度末を過ぎたら 409。受付前も 409。テナント管理者は代理・修正としていつでも renewal と同じ操作ができる
// - 対象でないチーム（協会員の登録をしないチーム）には申告させない（409）。個人登録は常に対象

export type DeclarationMode = "before" | "renewal" | "additional" | "closed";

export type DeclarationPlayer = {
  teamMemberId: string;
  memberId: string;
  name: string;
  kana: string | null;
  // 昨年度の会員（approved）。画面で「昨年度の会員」ラベルと初期チェック
  lastYearMember: boolean;
  // 当年度の行の状態（なければ null）
  status: MembershipStatus | null;
  // 初期チェック: 当年度が applied / approved、または当年度の行がなく昨年度の会員
  checked: boolean;
  // 追加の申告では、すでに申告した人は外せない
  locked: boolean;
};

export type DeclarationView = {
  team: { id: string; name: string; kind: TeamKind };
  // 協会員の登録の対象か（登録をするチーム・個人登録）
  target: boolean;
  // 受付中の年度。なければ直近の年度（締切後の表示用）。1 つもなければ null
  period: MembershipPeriod | null;
  mode: DeclarationMode | null;
  // 追加の申告を送れる年度の末日（mode = additional のときの案内用）
  fiscalYearEnd: Date | null;
  declared: { submittedAt: Date; updatedAt: Date } | null;
  // テナント管理者（締切後も直せる）
  isAdmin: boolean;
  canSubmit: boolean;
  players: DeclarationPlayer[];
};

type Actor = Principal & { userId: string };

const ACTIVE: readonly MembershipStatus[] = ["applied", "approved"];

async function resolvePeriod(tx: Parameters<typeof findOpenMembershipPeriod>[0], associationId: string, now: Date): Promise<MembershipPeriod | null> {
  return (await findOpenMembershipPeriod(tx, associationId, now)) ?? (await listMembershipPeriods(tx, associationId))[0] ?? null;
}

export function declarationMode(period: MembershipPeriod, now: Date, fiscalYearStartMonth: number, isAdmin: boolean): DeclarationMode {
  if (isAdmin) return "renewal";
  const state = periodState(period, now);
  if (state === "before") return "before";
  if (state === "open") return "renewal";
  const end = endOfDayTokyo(fiscalYearEndOf(period.year, fiscalYearStartMonth));
  return now.getTime() <= end.getTime() ? "additional" : "closed";
}

export async function getDeclarationView(db: Db, principal: Actor, associationId: string, teamId: string, now: Date = new Date()): Promise<DeclarationView> {
  const startMonth = (await findAssociationById(db, associationId))?.fiscalYearStartMonth ?? 4;
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team, role } = await authorizeTeam(tx, principal, associationId, teamId, "declareMembership");
      const isAdmin = roleIncludes(role, "association_admin");
      const target = isRenewalTarget(team);
      const period = await resolvePeriod(tx, associationId, now);
      const mode = period ? declarationMode(period, now, startMonth, isAdmin) : null;
      const roster = await listActiveRoster(tx, associationId, teamId);
      const rows = period
        ? await listMembershipRows(
            tx,
            associationId,
            roster.map((r) => r.memberId),
            [period.year, period.year - 1],
          )
        : new Map();
      const declared = period ? await findDeclaration(tx, associationId, teamId, period.year) : null;
      const players = roster.map((r): DeclarationPlayer => {
        const byYear = rows.get(r.memberId);
        const current = period ? byYear?.get(period.year) : undefined;
        const lastYearMember = period ? isApproved(byYear?.get(period.year - 1)) : false;
        const active = current ? ACTIVE.includes(current.status) : false;
        return {
          teamMemberId: r.teamMemberId,
          memberId: r.memberId,
          name: r.name,
          kana: r.kana,
          lastYearMember,
          status: current?.status ?? null,
          checked: current ? active : lastYearMember,
          locked: mode === "additional" && active,
        };
      });
      return {
        team: { id: team.id, name: team.name, kind: team.kind },
        target,
        period,
        mode,
        fiscalYearEnd: period ? endOfDayTokyo(fiscalYearEndOf(period.year, startMonth)) : null,
        declared: declared ? { submittedAt: declared.submittedAt, updatedAt: declared.updatedAt } : null,
        isAdmin,
        canSubmit: target && (mode === "renewal" || mode === "additional"),
        players,
      };
    },
    { userId: principal.userId },
  );
}

export type DeclarationResult = { year: number; mode: DeclarationMode; checked: number; applied: number; approved: number; declined: number; unchanged: number };

export async function submitDeclaration(
  db: Db,
  principal: Actor,
  associationId: string,
  teamId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<DeclarationResult> {
  const ids = Array.isArray(raw.memberIds) ? raw.memberIds : null;
  if (!ids || !ids.every((id) => typeof id === "string" && isUuid(id))) throw new TeamError(400, "登録する人の選び方が正しくありません");
  const checkedIds = new Set(ids as string[]);
  const startMonth = (await findAssociationById(db, associationId))?.fiscalYearStartMonth ?? 4;

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team, role } = await authorizeTeam(tx, principal, associationId, teamId, "declareMembership");
      const isAdmin = roleIncludes(role, "association_admin");
      if (!isRenewalTarget(team)) throw new TeamError(409, "このチームは協会員の登録の対象になっていません。チーム情報の「協会員の登録をするチーム」を変えてください");

      const period = await resolvePeriod(tx, associationId, now);
      if (!period) throw new TeamError(409, "協会員の登録の受付はまだ始まっていません");
      const mode = declarationMode(period, now, startMonth, isAdmin);
      if (mode === "before") throw new TeamError(409, "協会員の登録の受付はまだ始まっていません");
      if (mode === "closed") throw new TeamError(409, "この年度の協会員の登録は終了しました。運営にお知らせください");

      const roster = await listActiveRoster(tx, associationId, teamId);
      const rosterIds = new Set(roster.map((r) => r.memberId));
      for (const id of checkedIds) {
        if (!rosterIds.has(id)) throw new TeamError(400, "選手一覧にいない人が含まれています。ページを読み直してください");
      }
      const rows = await listMembershipRows(tx, associationId, [...rosterIds], [period.year, period.year - 1]);
      const result: DeclarationResult = { year: period.year, mode, checked: checkedIds.size, applied: 0, approved: 0, declined: 0, unchanged: 0 };
      // 追加の申告は承認を省く年度でも承認が要る（§5.12）
      const autoApprove = mode === "renewal" && period.autoApprove;
      const source = mode === "additional" ? ("additional" as const) : ("renewal" as const);

      for (const member of roster) {
        const byYear = rows.get(member.memberId);
        const current = byYear?.get(period.year);
        const lastYearMember = isApproved(byYear?.get(period.year - 1));
        if (checkedIds.has(member.memberId)) {
          if (current && ACTIVE.includes(current.status)) {
            result.unchanged += 1;
            continue;
          }
          const values = {
            status: (autoApprove ? "approved" : "applied") as MembershipStatus,
            source,
            teamId,
            appliedBy: principal.userId,
            appliedAt: now,
            approvedBy: null,
            approvedAt: autoApprove ? now : null,
          };
          if (current) await updateMembership(tx, associationId, current.id, values);
          else await insertMembership(tx, associationId, { memberId: member.memberId, year: period.year, ...values });
          if (autoApprove) result.approved += 1;
          else result.applied += 1;
        } else if (mode === "additional") {
          // 追加の申告では外せない（運営に依頼する）
          result.unchanged += 1;
        } else if (current && ACTIVE.includes(current.status)) {
          await updateMembership(tx, associationId, current.id, { status: "declined", teamId, appliedBy: principal.userId, appliedAt: now });
          result.declined += 1;
        } else if (!current && lastYearMember) {
          await insertMembership(tx, associationId, {
            memberId: member.memberId,
            teamId,
            year: period.year,
            status: "declined",
            source: "renewal",
            appliedBy: principal.userId,
            appliedAt: now,
          });
          result.declined += 1;
        } else {
          result.unchanged += 1;
        }
      }

      await upsertDeclaration(tx, associationId, teamId, period.year, principal.userId, now);
      // 申告の控えは、そのチームの有効な代表者全員へ（同じトランザクションで送信待ちに積む・§11）
      for (const admin of await listTeamAdmins(tx, associationId, teamId)) {
        await enqueueMail(tx, {
          associationId,
          mailType: "membership_applied",
          toEmail: admin.email,
          userId: admin.userId,
          params: { teamId, year: period.year, additional: mode === "additional", count: result.applied + result.approved },
        });
      }
      return result;
    },
    { userId: principal.userId },
  );
}
