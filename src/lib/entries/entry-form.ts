import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { getMembership } from "@/lib/auth/principal";
import { type Principal, resolveRole } from "@/lib/authz";
import { effectiveAgeReferenceDate, effectiveDeadline, type EntryState, entryState, tournamentEntryState } from "@/lib/deadline";
import type { PlainDate } from "@/lib/date";
import { isUuid } from "@/lib/ids";
import { listTeamsAdminedBy } from "@/lib/repo/teams";
import { listTournamentCategories } from "@/lib/repo/tournament-categories";
import { findPublicTournament, type Tournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";
import { categoryConditionText } from "@/lib/tournaments/category-text";

// 申込の入力ページが要る材料（設計書 §5.5「入力ページ」1・2・4・5）。選手枠は B-09、送信は B-10
//
// 入力ページは**ログインした人なら開ける**（§5.5 v0.9）。そのチームの有効な代表者かどうかは送信時に検査する。
// 締切・定員は業務上の条件なので 409（403 と混ぜない・§3.1）。テナント管理者は締切後でも開ける（§3.2）

export type EntryFormTeam = { id: string; name: string };

export type EntryFormCategory = {
  id: string;
  label: string;
  condition: string;
  entryEndAt: Date;
  ageReferenceDate: PlainDate;
  state: EntryState;
  selectable: boolean; // 受付中か、テナント管理者が開いているか
};

export type EntryFormData = {
  tournament: Tournament;
  teams: EntryFormTeam[]; // 代表者を務めるチームだけ（個人登録・無効なチームは出さない・§5.5）
  categories: EntryFormCategory[];
  isAssociationAdmin: boolean;
  // 入力ページを開いたときに発行する、送信用のワンタイムの値（消費は B-10）
  token: string;
};

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

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      // 準備中（draft）の大会は、公開ページと同じく見つからない扱い（§5.6）
      const tournament = await findPublicTournament(tx, associationId, tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");

      const rows = await listTournamentCategories(tx, associationId, tournamentId);
      const categories: EntryFormCategory[] = rows.map((category) => {
        const state = entryState(tournament, category, now);
        return {
          id: category.id,
          label: category.label,
          condition: categoryConditionText(category, effectiveAgeReferenceDate(category, tournament)),
          entryEndAt: effectiveDeadline(category, tournament),
          ageReferenceDate: effectiveAgeReferenceDate(category, tournament),
          state,
          selectable: state === "open" || isAssociationAdmin,
        };
      });

      // どの部も受け付けていなければ 409（管理者は締切後でも申し込める・§3.2）
      const overall = tournamentEntryState(tournament, rows, now);
      if (overall !== "open" && !isAssociationAdmin) {
        throw new TeamError(409, overall === "not_started" ? "申し込みの受付はまだ始まっていません" : "申し込みの受付は終了しました");
      }

      // 代表者を務めるチームだけ（選手として所属しているだけのチーム・個人登録・無効にしたチームは出さない）
      const teams = (await listTeamsAdminedBy(tx, associationId, userId))
        .filter((team) => team.kind === "team" && team.status === "active" && !team.deletedAt)
        .map((team) => ({ id: team.id, name: team.name }));

      return { tournament, teams, categories, isAssociationAdmin, token: crypto.randomUUID() };
    },
    { userId },
  );
}
