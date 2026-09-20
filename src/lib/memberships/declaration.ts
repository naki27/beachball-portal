import type { Db } from "@/db/client";
import type { MembershipStatus } from "@/db/schema/memberships";
import { type Tx, withTenantOn } from "@/db/tenant";
import type { Principal } from "@/lib/authz";
import { currentFiscalYear, renewalState } from "@/lib/membership";
import { enqueueMail } from "@/lib/mail/outbox";
import { findAssociationById } from "@/lib/repo/associations";
import {
  findMembershipDeclaration,
  findMembershipPeriod,
  listMembershipStatuses,
  type MembershipPeriod,
  upsertMembershipDeclaration,
  upsertMembershipStatus,
} from "@/lib/repo/memberships";
import { listActiveRoster } from "@/lib/repo/team-members";
import { listTeamAdmins } from "@/lib/repo/teams";
import { authorizeTeam } from "@/lib/teams/access";
import { TeamError } from "@/lib/teams/errors";

// 年度更新の申告（設計書 §5.12「申告フロー」・D-03）。チームの代表者が「その年度も登録する人」を選んで送る
//
// - 前年度の協会員には初期チェックを入れる（初年度は前年度のデータがないので、初期チェックは付かない）
// - **締切前なら、承認済みでも直せる**。直した人（チェックを入れた・外した）だけが変わり、変えていない人はそのまま
// - チェックを入れた人 → applied（承認を省く年度は approved）／外した人 → declined
// - 締切後は代表者は送れない（409）。追加の申告と運営の代理は D-04

export type DeclarationPlayer = {
  memberId: string;
  name: string;
  kana: string | null;
  // 昨年度の協会員か（画面の「昨年度の会員」の印と、初期チェック）
  wasMemberLastYear: boolean;
  // いまの状態（申告済みならその状態）
  status: MembershipStatus | null;
  // 画面の初期チェック
  checked: boolean;
};

export type DeclarationForm = {
  teamId: string;
  teamName: string;
  year: number;
  closesAt: Date;
  autoApprove: boolean;
  // すでに送信しているか（送信日時）
  submittedAt: Date | null;
  players: DeclarationPlayer[];
};

type Actor = Principal & { userId: string };

async function startMonthOf(db: Db, associationId: string): Promise<number> {
  return (await findAssociationById(db, associationId))?.fiscalYearStartMonth ?? 4;
}

// 受付中の年度と受付。受付がない・期間外なら 409（画面にも API にも同じ判定を使う）
async function requireOpenPeriod(tx: Tx, associationId: string, year: number, now: Date): Promise<MembershipPeriod> {
  const period = await findMembershipPeriod(tx, associationId, year);
  const state = renewalState(period, now);
  if (!period || state === null) throw new TeamError(409, `${year}年度の協会員の受付はまだ始まっていません`);
  if (state === "not_started") throw new TeamError(409, `${year}年度の協会員の受付はまだ始まっていません`);
  if (state === "closed") throw new TeamError(409, `${year}年度の協会員の受付は終了しました。運営にお問い合わせください`);
  return period;
}

async function loadForm(tx: Tx, associationId: string, team: { id: string; name: string }, period: MembershipPeriod, year: number): Promise<DeclarationForm> {
  const roster = await listActiveRoster(tx, associationId, team.id);
  const memberIds = roster.map((row) => row.memberId);
  const [current, previous, declaration] = await Promise.all([
    listMembershipStatuses(tx, associationId, year, memberIds),
    listMembershipStatuses(tx, associationId, year - 1, memberIds),
    findMembershipDeclaration(tx, associationId, team.id, year),
  ]);

  return {
    teamId: team.id,
    teamName: team.name,
    year,
    closesAt: period.closesAt,
    autoApprove: period.autoApprove,
    submittedAt: declaration?.submittedAt ?? null,
    players: roster.map((row) => {
      const status = current.get(row.memberId) ?? null;
      const wasMemberLastYear = previous.get(row.memberId) === "approved";
      return {
        memberId: row.memberId,
        name: row.name,
        kana: row.kana,
        wasMemberLastYear,
        status,
        // 一度送ったあとは、いまの状態をそのまま出す。まだなら前年度の会員に初期チェック
        checked: status === null ? (declaration ? false : wasMemberLastYear) : status === "applied" || status === "approved",
      };
    }),
  };
}

export async function getDeclarationForm(
  db: Db,
  principal: Actor,
  associationId: string,
  teamId: string,
  now: Date = new Date(),
): Promise<DeclarationForm> {
  const year = currentFiscalYear(await startMonthOf(db, associationId), now);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team } = await authorizeTeam(tx, principal, associationId, teamId, "declareMembership");
      // 対象でないチームには申告の画面を出さない（対象に変えれば出る・§5.12）
      if (!team.membershipRenewalTarget) {
        throw new TeamError(409, "このチームは協会員の登録をするチームになっていません。チーム情報から変えられます");
      }
      if (team.status !== "active") throw new TeamError(409, "無効になっているチームでは申告できません");
      const period = await requireOpenPeriod(tx, associationId, year, now);
      return loadForm(tx, associationId, team, period, year);
    },
    { userId: principal.userId },
  );
}

export type SubmitDeclarationResult = { year: number; added: number; removed: number; unchanged: number };

// 申告の送信（何度でも送り直せる。変えていない人の状態は変えない）
export async function submitDeclaration(
  db: Db,
  principal: Actor,
  associationId: string,
  teamId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<SubmitDeclarationResult> {
  const year = currentFiscalYear(await startMonthOf(db, associationId), now);
  // チェックを入れた人の member_id。全員外して送ることもできる（それでも「申告済み」になる）
  const chosen = new Set(Array.isArray(raw.memberIds) ? raw.memberIds.filter((id): id is string => typeof id === "string") : []);

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team } = await authorizeTeam(tx, principal, associationId, teamId, "declareMembership");
      if (!team.membershipRenewalTarget) {
        throw new TeamError(409, "このチームは協会員の登録をするチームになっていません。チーム情報から変えられます");
      }
      if (team.status !== "active") throw new TeamError(409, "無効になっているチームでは申告できません");
      const period = await requireOpenPeriod(tx, associationId, year, now);

      const roster = await listActiveRoster(tx, associationId, teamId);
      const memberIds = roster.map((row) => row.memberId);
      // 選手一覧にいない人は受け付けない（ほかのチームの人物を勝手に登録させない）
      for (const memberId of chosen) {
        if (!memberIds.includes(memberId)) throw new TeamError(400, "選手一覧にない人が選ばれています", { field: "memberIds" });
      }

      const current = await listMembershipStatuses(tx, associationId, year, memberIds);
      const previous = await listMembershipStatuses(tx, associationId, year - 1, memberIds);
      const wanted: MembershipStatus = period.autoApprove ? "approved" : "applied";

      const result: SubmitDeclarationResult = { year, added: 0, removed: 0, unchanged: 0 };
      for (const memberId of memberIds) {
        const status = current.get(memberId) ?? null;
        if (chosen.has(memberId)) {
          // すでに申告済み・承認済みなら触らない（承認を取り消さない）
          if (status === "applied" || status === "approved") {
            result.unchanged += 1;
            continue;
          }
          await upsertMembershipStatus(tx, associationId, {
            memberId,
            teamId,
            year,
            status: wanted,
            source: "renewal",
            appliedBy: principal.userId,
            appliedAt: now,
            // 承認を省く年度は、承認した人を残さない（人が承認したわけではない）
            approvedBy: null,
            approvedAt: period.autoApprove ? now : null,
          });
          result.added += 1;
          continue;
        }
        // チェックが外れている人
        if (status === "applied" || status === "approved") {
          // 申告し直して外した → 更新しない
          await upsertMembershipStatus(tx, associationId, {
            memberId,
            teamId,
            year,
            status: "declined",
            source: "renewal",
            appliedBy: principal.userId,
            appliedAt: now,
            approvedBy: null,
            approvedAt: null,
          });
          result.removed += 1;
        } else if (status === null && previous.get(memberId) === "approved") {
          // 昨年度の会員を外した → 「更新しない」と明示された記録を残す（§5.12 モデル）
          await upsertMembershipStatus(tx, associationId, {
            memberId,
            teamId,
            year,
            status: "declined",
            source: "renewal",
            appliedBy: principal.userId,
            appliedAt: now,
            approvedBy: null,
            approvedAt: null,
          });
          result.removed += 1;
        } else {
          result.unchanged += 1;
        }
      }

      // チームが申告を送ったことの記録（全員のチェックを外して送っても「申告済み」になる・§5.12 モデル）
      await upsertMembershipDeclaration(tx, associationId, teamId, year, principal.userId, now);

      // 申告の控え（§11 の membership_applied）。有効な代表者全員に積む
      for (const admin of await listTeamAdmins(tx, associationId, teamId)) {
        await enqueueMail(tx, {
          associationId,
          mailType: "membership_applied",
          toEmail: admin.email,
          userId: admin.userId,
          params: { teamId, year },
        });
      }
      return result;
    },
    { userId: principal.userId },
  );
}
