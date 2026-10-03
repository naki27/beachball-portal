import type { MemberSex } from "@/db/schema";
import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import { getMembership } from "@/lib/auth/principal";
import { type Principal, resolveRole } from "@/lib/authz";
import { effectiveAgeReferenceDate, effectiveDeadline, type EntryState, entryState, tournamentEntryState } from "@/lib/deadline";
import { fiscalYear, type PlainDate, todayInTokyo } from "@/lib/date";
import type { EligibilityPreset } from "@/lib/eligibility";
import { isUuid } from "@/lib/ids";
import { findAssociationById } from "@/lib/repo/associations";
import { hasMembershipsForYear, listApprovedMemberIds } from "@/lib/repo/memberships";
import { listActiveRoster } from "@/lib/repo/team-members";
import { listTeamsAdminedBy } from "@/lib/repo/teams";
import { listTournamentCategories, type TournamentCategory } from "@/lib/repo/tournament-categories";
import { findPublicTournament, type Tournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";
import { categoryConditionText } from "@/lib/tournaments/category-text";

// 申込の入力ページが要る材料（設計書 §5.5「入力ページ」1・2・4・5）。選手枠は B-09、送信は B-10
//
// 入力ページは**ログインした人なら開ける**（§5.5 v0.9）。そのチームの有効な代表者かどうかは送信時に検査する。
// 締切・定員は業務上の条件なので 409（403 と混ぜない・§3.1）。テナント管理者は締切後でも開ける（§3.2）

export type EntryFormTeam = { id: string; name: string };

// 申し込むチームの選手一覧（プルダウンの候補）。代表者を務めるチームなので、生年月日を出してよい（§3.2）
export type EntryFormPlayer = {
  memberId: string;
  name: string;
  kana: string | null;
  birthDate: string; // YYYY-MM-DD
  sex: MemberSex;
  isMember: boolean; // 大会の開催日の年度の協会員か（§5.12）
};

export type EntryFormCategory = {
  id: string;
  code: string; // 前回コピーの突合（表示名が変わっても対応づく・§5.5(b)）
  label: string;
  condition: string;
  entryEndAt: Date;
  ageReferenceDate: PlainDate;
  state: EntryState;
  selectable: boolean; // 受付中か、テナント管理者が開いているか
  // 資格バリデーション（§5.5(e)）に渡す設定値。数値はすべて部門プリセットから読む
  preset: EligibilityPreset;
};

export type EntryFormData = {
  tournament: Tournament;
  teams: EntryFormTeam[]; // 代表者を務めるチームだけ（個人登録・無効なチームは出さない・§5.5）
  categories: EntryFormCategory[];
  // チームごとの選手一覧。代表者を務めるチームだけなので、どれを選んでも見てよい（§3.2）
  rosters: Record<string, EntryFormPlayer[]>;
  teamSizeMin: number;
  teamSizeMax: number;
  // 大会の開催日の年度（サジェストの「協会員だけを表示」に渡す・§5.12）
  year: number;
  // その年度の協会員のデータがなければスイッチを出さない（§5.5「入力ページ」3）
  showMembersOnly: boolean;
  isAssociationAdmin: boolean;
  // 入力ページを開いたときに発行する、送信用のワンタイムの値（消費は B-10）
  token: string;
};

// 部の一覧の作り方は入力ページと変更ページで同じ（§5.5）。ここ 1 か所にする
export function toEntryFormCategory(
  category: TournamentCategory,
  tournament: Tournament,
  isAssociationAdmin: boolean,
  now: Date,
): EntryFormCategory {
  const state = entryState(tournament, category, now);
  return {
    id: category.id,
    code: category.code,
    label: category.label,
    preset: {
      gender: category.gender,
      ruleType: category.ruleType,
      ruleValue: category.ruleValue,
      courtSize: category.courtSize,
      mixedMinMale: category.mixedMinMale,
      mixedMinFemale: category.mixedMinFemale,
    },
    condition: categoryConditionText(category, effectiveAgeReferenceDate(category, tournament)),
    entryEndAt: effectiveDeadline(category, tournament),
    ageReferenceDate: effectiveAgeReferenceDate(category, tournament),
    state,
    selectable: state === "open" || isAssociationAdmin,
  };
}

// チームの選手一覧（プルダウンの候補）。協会員かどうかはその年度のデータで決める（§5.12）
export async function loadEntryFormRoster(
  tx: Tx,
  associationId: string,
  teamId: string,
  year: number,
): Promise<EntryFormPlayer[]> {
  const rows = await listActiveRoster(tx, associationId, teamId);
  const approved = await listApprovedMemberIds(tx, associationId, year, rows.map((row) => row.memberId));
  return rows.map((row) => ({
    memberId: row.memberId,
    name: row.name,
    kana: row.kana,
    birthDate: row.birthDate,
    sex: row.sex,
    isMember: approved.has(row.memberId),
  }));
}

export async function getEntryFormData(
  db: Db,
  principal: Principal,
  associationId: string,
  tournamentId: string,
  now: Date = new Date(),
): Promise<EntryFormData> {
  if (!principal.userId) throw new TeamError(403, "ログインが必要です");
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  const userId = principal.userId;
  const membership = await getMembership(principal, associationId);
  const isAssociationAdmin = resolveRole(principal, membership, { associationId }) === "association_admin";
  // 年度の開始月は協会ごとに違う（associations はテナントに属さないので withTenant の外で読む）
  const fiscalYearStartMonth = (await findAssociationById(db, associationId))?.fiscalYearStartMonth ?? 4;

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      // 準備中（draft）の大会は、公開ページと同じく見つからない扱い（§5.6）
      const tournament = await findPublicTournament(tx, associationId, tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");

      const categoryRows = await listTournamentCategories(tx, associationId, tournamentId);
      const categories = categoryRows.map((category) => toEntryFormCategory(category, tournament, isAssociationAdmin, now));

      // どの部も受け付けていなければ 409（管理者は締切後でも申し込める・§3.2）
      const overall = tournamentEntryState(tournament, categoryRows, now);
      if (overall !== "open" && !isAssociationAdmin) {
        throw new TeamError(409, overall === "not_started" ? "申し込みの受付はまだ始まっていません" : "申し込みの受付は終了しました");
      }

      // 代表者を務めるチームだけ（選手として所属しているだけのチーム・個人登録・無効にしたチームは出さない）
      const adminedTeams = (await listTeamsAdminedBy(tx, associationId, userId)).filter(
        (team) => team.kind === "team" && team.status === "active" && !team.deletedAt,
      );
      const teams = adminedTeams.map((team) => ({ id: team.id, name: team.name }));

      // 選手枠のプルダウンの候補。チームを選び直しても読み直さずに済むよう、まとめて返す
      // 年度は大会の開催日で決める（未定なら今日・§5.12）
      const year = fiscalYear(tournament.eventDate ?? todayInTokyo(now), fiscalYearStartMonth);
      const rosters: Record<string, EntryFormPlayer[]> = {};
      const rosterRows = await Promise.all(adminedTeams.map((team) => listActiveRoster(tx, associationId, team.id)));
      const memberIds = [...new Set(rosterRows.flat().map((row) => row.memberId))];
      const approved = await listApprovedMemberIds(tx, associationId, year, memberIds);
      adminedTeams.forEach((team, index) => {
        rosters[team.id] = rosterRows[index].map((row) => ({
          memberId: row.memberId,
          name: row.name,
          kana: row.kana,
          birthDate: row.birthDate,
          sex: row.sex,
          isMember: approved.has(row.memberId),
        }));
      });
      const showMembersOnly = await hasMembershipsForYear(tx, associationId, year);

      return {
        tournament,
        teams,
        categories,
        rosters,
        teamSizeMin: tournament.teamSizeMin,
        teamSizeMax: tournament.teamSizeMax,
        year,
        showMembersOnly,
        isAssociationAdmin,
        token: crypto.randomUUID(),
      };
    },
    { userId },
  );
}
