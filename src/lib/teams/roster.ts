import type { Db } from "@/db/client";
import type { MemberSex } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { ageAt } from "@/lib/age";
import { can, type Principal } from "@/lib/authz";
import { parsePlainDate, type PlainDate, todayInTokyo } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { matchKeysOf, resolveMember } from "@/lib/matching";
import { updateMemberPerson } from "@/lib/repo/members";
import {
  addTeamMember,
  clearTeamMemberLeft,
  findActiveTeamMember,
  findTeamMemberRow,
  listActiveRoster,
  listRecentlyLeftBy,
  markTeamMemberLeft,
  type RosterRow,
} from "@/lib/repo/team-members";
import type { Team } from "@/lib/repo/teams";
import { authorizeTeam } from "./access";
import { TeamError } from "./errors";
import { parsePlayerInput, type PlayerInput } from "./player-input";

// 選手一覧（設計書 §5.11「名簿の管理」）。追加（保存時に名寄せ・§8.3）・修正・外す・元に戻す
// 見せる範囲は §3.2: 選手にはほかの人の生年月日・年齢・性別を返さない（本人の分は返す）

// 外してから元に戻せる時間（§5.11・30 分【仮】）
export const UNDO_LEAVE_WINDOW_MS = 30 * 60 * 1000;

export type Personal = { birthDate: string; age: number; sex: MemberSex };

export type RosterItem = {
  teamMemberId: string;
  memberId: string;
  name: string;
  kana: string | null;
  // 見ている人の人物か（members.user_id）
  isSelf: boolean;
  // 生年月日・年齢・性別。代表者以上と本人にだけ入る（§3.2）
  personal: Personal | null;
};

export type Roster = {
  team: Pick<Team, "id" | "name" | "kind" | "status">;
  // 代表者以上（追加・修正・外すができる）
  canManage: boolean;
  items: RosterItem[];
  // 見ている人が 30 分以内に外した行（「外しました［元に戻す］」）
  recentlyLeft: { teamMemberId: string; name: string; leftAt: string }[];
};

function personalOf(row: RosterRow, today: PlainDate): Personal {
  const birth = parsePlainDate(row.birthDate);
  return { birthDate: row.birthDate, age: birth ? ageAt(birth, today) : 0, sex: row.sex };
}

function requireTeamMemberId(teamMemberId: string): void {
  if (!isUuid(teamMemberId)) throw new TeamError(404, "選手が見つかりません");
}

// 選手一覧を読む。選手・代表者・テナント管理者（403 / 404 は authorizeTeam）
export async function getRoster(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  now: Date = new Date(),
): Promise<Roster> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team, role } = await authorizeTeam(tx, principal, associationId, teamId, "viewOwnTeamRoster");
      const canManage = can(role, "manageRoster");
      const today = todayInTokyo(now);
      const rows = await listActiveRoster(tx, associationId, teamId);
      const items = rows.map((row): RosterItem => {
        const isSelf = row.userId === principal.userId;
        const showPersonal = can(role, "viewPlayerPersonal", { self: isSelf });
        return {
          teamMemberId: row.teamMemberId,
          memberId: row.memberId,
          name: row.name,
          kana: row.kana,
          isSelf,
          personal: showPersonal ? personalOf(row, today) : null,
        };
      });
      const recentlyLeft = canManage
        ? (await listRecentlyLeftBy(tx, associationId, teamId, principal.userId, new Date(now.getTime() - UNDO_LEAVE_WINDOW_MS))).map(
            (row) => ({ teamMemberId: row.teamMemberId, name: row.name, leftAt: (row.leftAt as Date).toISOString() }),
          )
        : [];
      return { team: { id: team.id, name: team.name, kind: team.kind, status: team.status }, canManage, items, recentlyLeft };
    },
    { userId: principal.userId },
  );
}

export type AddPlayerResult = { teamMemberId: string; memberId: string; created: boolean; needsReview: boolean };

// 選手を追加する（代表者）。本人の情報を入力し、保存時に名寄せ（§8.3。サジェストの member_id は受け付けない）
// 氏名・生年月日・性別が一致する人物が協会にちょうど 1 人いれば、新しい人物を作らずその人物を加える
export async function addPlayer(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<AddPlayerResult> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team } = await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      if (team.kind === "individual") throw new TeamError(409, "個人の登録には、ほかの人を加えられません");
      const parsed = parsePlayerInput(raw, todayInTokyo(now));
      if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
      const resolved = await resolveMember(tx, associationId, parsed.value);
      if (await findActiveTeamMember(tx, associationId, teamId, resolved.memberId)) {
        throw new TeamError(409, "この方はすでに選手一覧にいます");
      }
      const row = await addTeamMember(tx, associationId, teamId, resolved.memberId);
      return { teamMemberId: row.id, memberId: resolved.memberId, created: resolved.created, needsReview: resolved.needsReview };
    },
    { userId: principal.userId },
  );
}

// 修正の画面に出す、その選手の今の情報（代表者だけ。生年月日を含む）
export async function getPlayerForEdit(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  teamMemberId: string,
): Promise<{ team: Team; teamMemberId: string; player: PlayerInput }> {
  requireTeamMemberId(teamMemberId);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team } = await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      const row = await findTeamMemberRow(tx, associationId, teamId, teamMemberId);
      if (!row || row.leftAt) throw new TeamError(404, "選手が見つかりません");
      return { team, teamMemberId, player: { name: row.name, kana: row.kana, birthDate: row.birthDate, sex: row.sex } };
    },
    { userId: principal.userId },
  );
}

// 選手の情報を修正する（代表者）。人物（members）はほかのチームとも共有されているので、そちらにも反映される
export async function updatePlayer(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  teamMemberId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<void> {
  requireTeamMemberId(teamMemberId);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      const row = await findTeamMemberRow(tx, associationId, teamId, teamMemberId);
      if (!row || row.leftAt) throw new TeamError(404, "選手が見つかりません");
      const parsed = parsePlayerInput(raw, todayInTokyo(now));
      if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
      const keys = matchKeysOf(parsed.value);
      await updateMemberPerson(tx, associationId, row.memberId, {
        ...parsed.value,
        nameNormalized: keys.nameNormalized,
        kanaNormalized: keys.kanaNormalized,
      });
    },
    { userId: principal.userId },
  );
}

// 選手一覧から外す（代表者。内部は脱退 left_at・left_by。人物は消えず、ほかのチームの選手一覧はそのまま・§5.11）
export async function leavePlayer(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  teamMemberId: string,
  now: Date = new Date(),
): Promise<{ leftAt: string }> {
  requireTeamMemberId(teamMemberId);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      const row = await findTeamMemberRow(tx, associationId, teamId, teamMemberId);
      if (!row) throw new TeamError(404, "選手が見つかりません");
      if (row.leftAt) throw new TeamError(409, "すでに選手一覧から外しています");
      await markTeamMemberLeft(tx, associationId, teamMemberId, principal.userId, now);
      return { leftAt: now.toISOString() };
    },
    { userId: principal.userId },
  );
}

// 外したのを元に戻す。外した本人だけが、外してから 30 分以内に（§5.11）
export async function undoLeave(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  teamMemberId: string,
  now: Date = new Date(),
): Promise<void> {
  requireTeamMemberId(teamMemberId);
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      const row = await findTeamMemberRow(tx, associationId, teamId, teamMemberId);
      if (!row) throw new TeamError(404, "選手が見つかりません");
      if (!row.leftAt) throw new TeamError(409, "この方は選手一覧にいます");
      if (row.leftBy !== principal.userId) throw new TeamError(403, "外した本人だけが元に戻せます");
      if (now.getTime() - row.leftAt.getTime() > UNDO_LEAVE_WINDOW_MS) {
        throw new TeamError(409, "元に戻せる時間を過ぎました。もう一度追加してください");
      }
      if (await findActiveTeamMember(tx, associationId, teamId, row.memberId)) {
        throw new TeamError(409, "この方はすでに選手一覧にいます");
      }
      await clearTeamMemberLeft(tx, associationId, teamMemberId);
    },
    { userId: principal.userId },
  );
}
