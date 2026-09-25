import type { MembershipStatus, TeamKind } from "@/db/schema";
import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { periodState, type PeriodState } from "@/lib/admin/membership-periods";
import { type Principal, roleIncludes } from "@/lib/authz";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";
import { isApproved } from "@/lib/membership";
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

// 年度更新の申告（設計書 §5.12「申告フロー」）。代表者が「その年度も登録する選手」にチェックを入れて送る
// - 送信で当年度の memberships を作る（applied。承認を省く年度は approved）。外した人は前年度の会員なら declined
// - 締切前なら何度でも直せる。直した人（入れた人・外した人）だけが変わり、変えていない人はそのまま
// - 締切後は代表者は 409（テナント管理者は代理で送れる・D-04）。追加の申告（年度の途中）は D-04
// - 対象でないチーム（協会員の登録をしないチーム）には申告させない（409）。個人登録は常に対象

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
};

export type DeclarationView = {
  team: { id: string; name: string; kind: TeamKind };
  // 協会員の登録の対象か（登録をするチーム・個人登録）
  target: boolean;
  // 受付中の年度。なければ直近の年度（締切後の表示用）。1 つもなければ null
  period: MembershipPeriod | null;
  state: PeriodState | null;
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

export async function getDeclarationView(db: Db, principal: Actor, associationId: string, teamId: string, now: Date = new Date()): Promise<DeclarationView> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team, role } = await authorizeTeam(tx, principal, associationId, teamId, "declareMembership");
      const isAdmin = roleIncludes(role, "association_admin");
      const target = isRenewalTarget(team);
      const period = await resolvePeriod(tx, associationId, now);
      const state = period ? periodState(period, now) : null;
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
        return {
          teamMemberId: r.teamMemberId,
          memberId: r.memberId,
          name: r.name,
          kana: r.kana,
          lastYearMember,
          status: current?.status ?? null,
          checked: current ? ACTIVE.includes(current.status) : lastYearMember,
        };
      });
      return {
        team: { id: team.id, name: team.name, kind: team.kind },
        target,
        period,
        state,
        declared: declared ? { submittedAt: declared.submittedAt, updatedAt: declared.updatedAt } : null,
        isAdmin,
        canSubmit: target && period !== null && (state === "open" || isAdmin),
        players,
      };
    },
    { userId: principal.userId },
  );
}

export type DeclarationResult = { year: number; checked: number; applied: number; approved: number; declined: number; unchanged: number };

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

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team, role } = await authorizeTeam(tx, principal, associationId, teamId, "declareMembership");
      const isAdmin = roleIncludes(role, "association_admin");
      if (!isRenewalTarget(team)) throw new TeamError(409, "このチームは協会員の登録の対象になっていません。チーム情報の「協会員の登録をするチーム」を変えてください");

      let period = await findOpenMembershipPeriod(tx, associationId, now);
      if (!period) {
        const latest = (await listMembershipPeriods(tx, associationId))[0];
        if (!latest) throw new TeamError(409, "協会員の登録の受付はまだ始まっていません");
        if (!isAdmin) {
          throw new TeamError(
            409,
            periodState(latest, now) === "before" ? "協会員の登録の受付はまだ始まっていません" : "受付は終了しました。直すときは運営にお知らせください",
          );
        }
        period = latest;
      }

      const roster = await listActiveRoster(tx, associationId, teamId);
      const rosterIds = new Set(roster.map((r) => r.memberId));
      for (const id of checkedIds) {
        if (!rosterIds.has(id)) throw new TeamError(400, "選手一覧にいない人が含まれています。ページを読み直してください");
      }
      const rows = await listMembershipRows(tx, associationId, [...rosterIds], [period.year, period.year - 1]);
      const result: DeclarationResult = { year: period.year, checked: checkedIds.size, applied: 0, approved: 0, declined: 0, unchanged: 0 };

      for (const member of roster) {
        const byYear = rows.get(member.memberId);
        const current = byYear?.get(period.year);
        const lastYearMember = isApproved(byYear?.get(period.year - 1));
        if (checkedIds.has(member.memberId)) {
          if (current && ACTIVE.includes(current.status)) {
            result.unchanged += 1;
            continue;
          }
          const status: MembershipStatus = period.autoApprove ? "approved" : "applied";
          const values = {
            status,
            source: "renewal" as const,
            teamId,
            appliedBy: principal.userId,
            appliedAt: now,
            approvedBy: null,
            approvedAt: period.autoApprove ? now : null,
          };
          if (current) await updateMembership(tx, associationId, current.id, values);
          else await insertMembership(tx, associationId, { memberId: member.memberId, year: period.year, ...values });
          if (period.autoApprove) result.approved += 1;
          else result.applied += 1;
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
          params: { teamId, year: period.year },
        });
      }
      return result;
    },
    { userId: principal.userId },
  );
}
