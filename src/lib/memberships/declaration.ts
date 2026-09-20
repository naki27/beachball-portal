import type { Db } from "@/db/client";
import type { MembershipStatus } from "@/db/schema/memberships";
import { type Tx, withTenantOn } from "@/db/tenant";
import { authorizeAssociationAdmin } from "@/lib/admin/access";
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
import { findTeam, listTeamAdmins } from "@/lib/repo/teams";
import { authorizeTeam } from "@/lib/teams/access";
import { TeamError } from "@/lib/teams/errors";

// 年度更新の申告（設計書 §5.12「申告フロー」「年度の途中の追加の申告」・D-03 / D-04）
//
// - 受付期間中（renewal）: 名簿にチェックを入れて送る。前年度の協会員には初期チェック
//   **締切前なら何度でも送り直せる**。直した人だけが変わり、変えていない人はそのまま
//   チェックを入れた人 → applied（承認を省く年度は approved）／外した人 → declined
// - 締切後〜年度末（additional）: **会員を増やすことだけ**ができる。外すのは運営に依頼する
//   自動承認の設定にかかわらず承認が必要（source = additional・status = applied）
// - 運営（テナント管理者）は締切後も代理で申告・修正できる

export type DeclarationMode = "renewal" | "additional";

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
  // 追加の申告では、すでに入っている人は外せない（外すのは運営に依頼する・§5.12）
  locked: boolean;
};

export type DeclarationForm = {
  teamId: string;
  teamName: string;
  year: number;
  mode: DeclarationMode;
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

// いまその年度に何ができるか。受付が一度も始まっていない年度には送れない（§5.12）
async function modeOf(tx: Tx, associationId: string, year: number, now: Date): Promise<{ period: MembershipPeriod; mode: DeclarationMode }> {
  const period = await findMembershipPeriod(tx, associationId, year);
  const state = renewalState(period, now);
  if (!period || state === null || state === "not_started") {
    throw new TeamError(409, `${year}年度の協会員の受付はまだ始まっていません`);
  }
  // 締切後も、その年度のうちは「追加の申告」ができる（年度は currentFiscalYear で数えるので、年度末を過ぎればここには来ない）
  return { period, mode: state === "open" ? "renewal" : "additional" };
}

async function loadTeamForDeclaration(tx: Tx, associationId: string, teamId: string, actor: Actor, asAdmin: boolean) {
  if (asAdmin) {
    // 運営の代理。対象でないチーム・無効なチームにも入力できる（§5.12「運営は代理で申告・修正できる」）
    await authorizeAssociationAdmin(tx, actor, associationId);
    const team = await findTeam(tx, associationId, teamId);
    if (!team) throw new TeamError(404, "チームが見つかりません");
    return team;
  }
  const { team } = await authorizeTeam(tx, actor, associationId, teamId, "declareMembership");
  // 対象でないチームには申告の画面を出さない（対象に変えれば出る・§5.12）
  if (!team.membershipRenewalTarget) {
    throw new TeamError(409, "このチームは協会員の登録をするチームになっていません。チーム情報から変えられます");
  }
  if (team.status !== "active") throw new TeamError(409, "無効になっているチームでは申告できません");
  return team;
}

async function loadForm(
  tx: Tx,
  associationId: string,
  team: { id: string; name: string },
  period: MembershipPeriod,
  mode: DeclarationMode,
  year: number,
): Promise<DeclarationForm> {
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
    mode,
    closesAt: period.closesAt,
    autoApprove: period.autoApprove,
    submittedAt: declaration?.submittedAt ?? null,
    players: roster.map((row) => {
      const status = current.get(row.memberId) ?? null;
      const wasMemberLastYear = previous.get(row.memberId) === "approved";
      const active = status === "applied" || status === "approved";
      return {
        memberId: row.memberId,
        name: row.name,
        kana: row.kana,
        wasMemberLastYear,
        status,
        // 一度送ったあとは、いまの状態をそのまま出す。まだなら前年度の会員に初期チェック
        checked: status === null ? (declaration ? false : wasMemberLastYear) : active,
        locked: mode === "additional" && active,
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
  options: { asAdmin?: boolean } = {},
): Promise<DeclarationForm> {
  const year = currentFiscalYear(await startMonthOf(db, associationId), now);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const team = await loadTeamForDeclaration(tx, associationId, teamId, principal, !!options.asAdmin);
      const { period, mode } = await modeOf(tx, associationId, year, now);
      // 運営の代理は締切後も受付期間中と同じように直せる（§5.12）
      return loadForm(tx, associationId, team, period, options.asAdmin ? "renewal" : mode, year);
    },
    { userId: principal.userId },
  );
}

export type SubmitDeclarationResult = { year: number; mode: DeclarationMode; added: number; removed: number; unchanged: number };

export type SubmitOptions = {
  // 運営（テナント管理者）の代理。締切後も直せる（§5.12）
  asAdmin?: boolean;
};

// 申告の送信。受付期間中は何度でも送り直せ、締切後は追加の申告（増やすだけ）になる
export async function submitDeclaration(
  db: Db,
  principal: Actor,
  associationId: string,
  teamId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
  options: SubmitOptions = {},
): Promise<SubmitDeclarationResult> {
  const year = currentFiscalYear(await startMonthOf(db, associationId), now);
  // チェックを入れた人の member_id。全員外して送ることもできる（それでも「申告済み」になる）
  const chosen = new Set(Array.isArray(raw.memberIds) ? raw.memberIds.filter((id): id is string => typeof id === "string") : []);

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const team = await loadTeamForDeclaration(tx, associationId, teamId, principal, !!options.asAdmin);
      const found = await modeOf(tx, associationId, year, now);
      const period = found.period;
      const mode: DeclarationMode = options.asAdmin ? "renewal" : found.mode;

      const roster = await listActiveRoster(tx, associationId, team.id);
      const memberIds = roster.map((row) => row.memberId);
      // 選手一覧にいない人は受け付けない（ほかのチームの人物を勝手に登録させない）
      for (const memberId of chosen) {
        if (!memberIds.includes(memberId)) throw new TeamError(400, "選手一覧にない人が選ばれています", { field: "memberIds" });
      }

      const current = await listMembershipStatuses(tx, associationId, year, memberIds);
      const previous = await listMembershipStatuses(tx, associationId, year - 1, memberIds);
      // 追加の申告は、承認を省く年度でも承認待ちにする（§5.12）
      const wanted: MembershipStatus = mode === "additional" ? "applied" : period.autoApprove ? "approved" : "applied";
      const approvedAt = mode === "renewal" && period.autoApprove ? now : null;

      const result: SubmitDeclarationResult = { year, mode, added: 0, removed: 0, unchanged: 0 };
      const write = (memberId: string, status: MembershipStatus, at: Date | null) =>
        upsertMembershipStatus(tx, associationId, {
          memberId,
          teamId: team.id,
          year,
          status,
          source: mode === "additional" ? "additional" : "renewal",
          appliedBy: principal.userId,
          appliedAt: now,
          // 承認を省く年度でも、承認した人は残さない（人が承認したわけではない）
          approvedBy: null,
          approvedAt: at,
        });

      for (const memberId of memberIds) {
        const status = current.get(memberId) ?? null;
        const active = status === "applied" || status === "approved";
        if (chosen.has(memberId)) {
          // すでに申告済み・承認済みなら触らない（承認を取り消さない）
          if (active) {
            result.unchanged += 1;
            continue;
          }
          await write(memberId, wanted, approvedAt);
          result.added += 1;
          continue;
        }
        // 追加の申告では外せない（チェックが外れていても何もしない）
        if (mode === "additional") {
          result.unchanged += 1;
          continue;
        }
        // 申告し直して外した人・昨年度の会員を外した人は「更新しない」の記録を残す（§5.12 モデル）
        if (active || (status === null && previous.get(memberId) === "approved")) {
          await write(memberId, "declined", null);
          result.removed += 1;
        } else {
          result.unchanged += 1;
        }
      }

      // チームが申告を送ったことの記録（全員のチェックを外して送っても「申告済み」になる・§5.12 モデル）
      await upsertMembershipDeclaration(tx, associationId, team.id, year, principal.userId, now);

      // 申告の控え（§11 の membership_applied）。有効な代表者全員に積む。何も変わらなければ送らない
      if (result.added > 0 || result.removed > 0) {
        for (const admin of await listTeamAdmins(tx, associationId, team.id)) {
          await enqueueMail(tx, {
            associationId,
            mailType: "membership_applied",
            toEmail: admin.email,
            userId: admin.userId,
            params: { teamId: team.id, year },
          });
        }
      }
      return result;
    },
    { userId: principal.userId },
  );
}
