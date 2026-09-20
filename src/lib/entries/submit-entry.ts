import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { ageAt } from "@/lib/age";
import { getMembership } from "@/lib/auth/principal";
import { can, type Principal, resolveRole } from "@/lib/authz";
import { todayInTokyo } from "@/lib/date";
import { effectiveAgeReferenceDate, entryState } from "@/lib/deadline";
import { hasEligibilityError, validateEligibility } from "@/lib/eligibility";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";
import { type MatchChoice, matchKeysOf, resolveMember } from "@/lib/matching";
import {
  countSubmittedEntries,
  findEntryBySubmitToken,
  hasEntryForTeamAndCategory,
  insertEntry,
  insertEntryPlayers,
  listDuplicatePlayersInTournament,
  lockTournamentForEntry,
  type NewEntryPlayer,
} from "@/lib/repo/entries";
import { bumpEntryCounts } from "@/lib/repo/members";
import { addTeamMember, findActiveTeamMember } from "@/lib/repo/team-members";
import { addTeamAdmin, createTeam, isActiveTeamAdmin, listTeamAdmins } from "@/lib/repo/teams";
import { findTournamentCategory } from "@/lib/repo/tournament-categories";
import { findPublicTournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";
import { parseEntryInput } from "./entry-input";
import { parsePlayerSlots, type PlayerSlot, toEligibilityPlayers } from "./player-slots";

// 申込の送信（設計書 §5.5(c)）。1 つのトランザクションで次をまとめて行う
//   その場のチームの作成 → 手入力の選手の名寄せ（§8.3）→ 申し込むチームの選手一覧への自動追加
//   → entries / entry_players → members.entry_count → 申込完了メールを送信待ちに積む（§11）
// 締切（§5.4）・申込上限（§5.4）・部門の資格（§5.5(e)）はサーバー側で必ず検査する。拒否は 409 / 400

export type EntryWarning = { kind: "duplicate_player" | "same_category"; message: string };

export type SubmitEntryResult = {
  entryId: string;
  // すでに同じワンタイムの値で作られていた（二重送信・「戻る」からの再送）
  alreadySubmitted: boolean;
  warnings: EntryWarning[];
  needsAdminCheck: boolean;
};

function choiceOf(slot: PlayerSlot): MatchChoice {
  if (slot.kind === "pick" && slot.memberId) return { kind: "picked", memberId: slot.memberId };
  if (slot.declinedSameName) return { kind: "declined" };
  return { kind: "none" };
}

export async function submitEntry(
  db: Db,
  principal: Principal,
  associationId: string,
  tournamentId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<SubmitEntryResult> {
  if (!principal.userId) throw new TeamError(403, "ログインが必要です");
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  const userId = principal.userId;

  const parsed = parseEntryInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  const input = parsed.value;
  if (!isUuid(input.token)) throw new TeamError(400, "画面を開き直してから、もう一度お試しください", { field: "token" });

  const slots = Array.isArray(raw.slots) ? (raw.slots as PlayerSlot[]) : [];
  const parsedSlots = parsePlayerSlots(slots, todayInTokyo(now));
  if (!parsedSlots.ok) {
    const first = parsedSlots.issues[0];
    throw new TeamError(400, first.message, { field: "slots", playerIndex: first.index, playerField: first.field });
  }
  const players = parsedSlots.players;

  const membership = await getMembership(principal, associationId);
  const role = resolveRole(principal, membership, { associationId });
  const isAssociationAdmin = role === "association_admin";

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      // 同じワンタイムの値での再送なら、2 件目を作らずに 1 件目を返す（§5.5）
      const already = await findEntryBySubmitToken(tx, associationId, input.token);
      if (already) return { entryId: already.id, alreadySubmitted: true, warnings: [], needsAdminCheck: already.needsAdminCheck };

      const tournament = await findPublicTournament(tx, associationId, tournamentId);
      if (!tournament) throw new TeamError(404, "大会が見つかりません");
      const category = await findTournamentCategory(tx, associationId, tournamentId, input.categoryId);
      if (!category) throw new TeamError(404, "部が見つかりません");

      // 申込上限を超えないよう、数える前に大会の行をロックして 1 件ずつ処理する（§5.4）
      await lockTournamentForEntry(tx, associationId, tournamentId);

      // 締切（部 → 大会のフォールバック）。テナント管理者は締切後でも申し込める（§3.2）
      const state = entryState(tournament, category, now);
      if (state !== "open" && !isAssociationAdmin) {
        throw new TeamError(409, state === "not_started" ? "この部の受付はまだ始まっていません" : "この部の申し込みは締め切りました", {
          field: "categoryId",
        });
      }

      // 人数（大会の下限・上限）
      if (players.length < tournament.teamSizeMin) {
        throw new TeamError(400, `この大会は${tournament.teamSizeMin}人以上で申し込みます`, { field: "slots" });
      }
      if (players.length > tournament.teamSizeMax) {
        throw new TeamError(400, `この大会は${tournament.teamSizeMax}人までです`, { field: "slots" });
      }

      // 部門の資格（§5.5(e)）。エラーがあれば保存しない
      const referenceDate = effectiveAgeReferenceDate(category, tournament);
      const eligibility = validateEligibility(toEligibilityPlayers(players), category, referenceDate);
      if (hasEligibilityError(eligibility)) {
        const error = eligibility.issues.find((issue) => issue.level === "error");
        throw new TeamError(409, error?.message ?? "この部の条件を満たしていません", { field: "slots", playerIndex: error?.playerIndex });
      }

      // 申し込むチーム。その場で作る場合も同じトランザクションの中で作る（§5.5 1）
      let teamId = input.teamId;
      if (teamId) {
        if (!(await isActiveTeamAdmin(tx, associationId, teamId, userId)) && !isAssociationAdmin) {
          throw new TeamError(403, "このチームの代表者だけが申し込めます", { field: "teamId" });
        }
      } else {
        if (!can(role, "createTeam")) throw new TeamError(403, "ログインが必要です");
        const team = await createTeam(tx, associationId, {
          name: input.newTeamName ?? input.teamName,
          kana: null,
          contactEmail: null,
          contactPhone: null,
          membershipRenewalTarget: false,
          kind: "team",
          createdBy: userId,
        });
        await addTeamAdmin(tx, associationId, team.id, userId, null);
        teamId = team.id;
      }

      // 申込上限（大会・部の両方。NULL は上限なし）。テナント管理者は超えられる（§5.4 v0.9.1）
      if (!isAssociationAdmin) {
        if (tournament.maxEntries !== null && (await countSubmittedEntries(tx, associationId, tournamentId)) >= tournament.maxEntries) {
          throw new TeamError(409, "この大会は定員に達しました", { field: "categoryId" });
        }
        if (category.maxEntries !== null && (await countSubmittedEntries(tx, associationId, tournamentId, category.id)) >= category.maxEntries) {
          throw new TeamError(409, "この部は定員に達しました", { field: "categoryId" });
        }
      }

      // 手入力の選手を名寄せし、選んだ選手はそのまま紐づける（§8.3）
      const resolved = [];
      for (const player of players) {
        const person = { name: player.name, kana: player.kana, birthDate: player.birthDate, sex: player.sex };
        resolved.push({ player, person, ...(await resolveMember(tx, associationId, person, choiceOf(player))) });
      }

      // 同じ申込の中に同じ人物が 2 回いたら拒否（§5.5「バリデーション」）
      const ids = resolved.map((r) => r.memberId);
      const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
      if (duplicate !== undefined) {
        const at = ids.lastIndexOf(duplicate);
        throw new TeamError(400, `${resolved[at].player.name}さんが 2 回入っています`, { field: "slots", playerIndex: at });
      }

      // 手入力の人と、代表者を務めるほかのチームから選んだ人を、申し込むチームの選手一覧に加える（§5.5(c) 4）
      for (const r of resolved) {
        if (!(await findActiveTeamMember(tx, associationId, teamId, r.memberId))) {
          await addTeamMember(tx, associationId, teamId, r.memberId);
        }
      }

      // 警告（送信は止めない・§5.5）
      const warnings: EntryWarning[] = [];
      for (const found of await listDuplicatePlayersInTournament(tx, associationId, tournamentId, ids)) {
        warnings.push({
          kind: "duplicate_player",
          message: `${found.name}さんは、この大会の別の申し込み（${found.teamName}・${found.categoryLabel}）にも登録されています`,
        });
      }
      if (await hasEntryForTeamAndCategory(tx, associationId, tournamentId, teamId, category.id)) {
        warnings.push({ kind: "same_category", message: "このチームはこの部にすでに申し込んでいます" });
      }

      // 運営の確認対象の印: 合計年齢の部と、名寄せで要確認になった人（重複の警告では立てない・§5.5）
      const needsAdminCheck = eligibility.needsAdminCheck || resolved.some((r) => r.needsReview);

      const entry = await insertEntry(tx, associationId, {
        tournamentId,
        categoryId: category.id,
        teamId,
        createdBy: userId,
        teamName: input.teamName,
        note: input.note,
        needsAdminCheck,
        submitToken: input.token,
      });

      const rows: NewEntryPlayer[] = resolved.map((r, index) => {
        const keys = matchKeysOf(r.person);
        return {
          position: index + 1,
          name: r.person.name,
          kana: r.person.kana,
          birthDate: r.person.birthDate,
          sex: r.person.sex,
          ageAtEvent: ageAt(toEligibilityPlayers([r.player])[0].birthDate, referenceDate),
          nameNormalized: keys.nameNormalized,
          kanaNormalized: keys.kanaNormalized,
          memberId: r.memberId,
          matchType: r.matchType,
        };
      });
      await insertEntryPlayers(tx, associationId, entry.id, rows);
      await bumpEntryCounts(tx, associationId, ids, now);

      // 申込完了メールは、そのチームの有効な代表者全員へ（§5.7）。同じトランザクションで送信待ちに積む（§11）
      for (const admin of await listTeamAdmins(tx, associationId, teamId)) {
        await enqueueMail(tx, {
          associationId,
          mailType: "entry_completed",
          toEmail: admin.email,
          userId: admin.userId,
          entryId: entry.id,
          params: { entryId: entry.id },
        });
      }

      return { entryId: entry.id, alreadySubmitted: false, warnings, needsAdminCheck };
    },
    { userId },
  );
}
