import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import { ageAt } from "@/lib/age";
import { getMembership } from "@/lib/auth/principal";
import { type Principal, resolveRole } from "@/lib/authz";
import { todayInTokyo } from "@/lib/date";
import { effectiveAgeReferenceDate, entryState } from "@/lib/deadline";
import { hasEligibilityError, validateEligibility } from "@/lib/eligibility";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";
import { type MatchChoice, matchKeysOf, resolveMember } from "@/lib/matching";
import {
  cancelEntryRow,
  deleteEntryPlayers,
  type Entry,
  findEntry,
  hasEntryForTeamAndCategory,
  insertEntryAudit,
  insertEntryPlayers,
  listDuplicatePlayersInTournament,
  listEntryPlayers,
  type NewEntryPlayer,
  updateEntryRow,
} from "@/lib/repo/entries";
import { bumpEntryCounts, unbumpEntryCounts } from "@/lib/repo/members";
import { addTeamMember, findActiveTeamMember } from "@/lib/repo/team-members";
import { isActiveTeamAdmin, listTeamAdmins } from "@/lib/repo/teams";
import { findTournamentCategory } from "@/lib/repo/tournament-categories";
import { findTournament, type Tournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";
import { parseEntryEditInput } from "./entry-input";
import { parsePlayerSlots, type PlayerSlot, toEligibilityPlayers } from "./player-slots";
import type { EntryWarning } from "./submit-entry";

// 申込の変更・取消（設計書 §5.5(d)）
//   締切まで … そのチームの代表者が何度でも変更・取消できる。取消は status = cancelled（元に戻せない）
//   締切後   … 代表者は 409（画面も読み取り専用にするが、API でも必ず止める）。テナント管理者は変更でき、
//              `entries.updated_by` と `entry_audits` に記録が残る（生年月日は入れない・§5.16）
// 名寄せは**その変更で新たに手入力された選手だけ**（すでに紐づいている選手は結び直さない・§5.5(d)）

export type UpdateEntryResult = {
  entryId: string;
  warnings: EntryWarning[];
  needsAdminCheck: boolean;
};

type Gate = { entry: Entry; tournament: Tournament; isAssociationAdmin: boolean };

function choiceOf(slot: PlayerSlot): MatchChoice {
  if (slot.kind === "pick" && slot.memberId) return { kind: "picked", memberId: slot.memberId };
  if (slot.declinedSameName) return { kind: "declined" };
  return { kind: "none" };
}

// 資源 → 権限 → 業務上の条件（§3.1）の順で見る。締切は**その申込の部門の締切**（§5.4）
async function authorizeEntryChange(
  tx: Tx,
  principal: Principal & { userId: string },
  associationId: string,
  entryId: string,
  isAssociationAdmin: boolean,
  now: Date,
): Promise<Gate> {
  if (!isUuid(entryId)) throw new TeamError(404, "申し込みが見つかりません");
  const entry = await findEntry(tx, associationId, entryId);
  if (!entry) throw new TeamError(404, "申し込みが見つかりません");

  const isTeamAdmin = await isActiveTeamAdmin(tx, associationId, entry.teamId, principal.userId);
  if (!isTeamAdmin && !isAssociationAdmin) throw new TeamError(403, "チームの代表者だけができます");

  const tournament = await findTournament(tx, associationId, entry.tournamentId);
  if (!tournament) throw new TeamError(404, "大会が見つかりません");
  const category = await findTournamentCategory(tx, associationId, entry.tournamentId, entry.categoryId);
  if (!category) throw new TeamError(404, "部が見つかりません");

  if (!isAssociationAdmin && entryState(tournament, category, now) !== "open") {
    throw new TeamError(409, "この部の申し込みは締め切りました。変更は運営へお問い合わせください");
  }
  if (entry.status === "cancelled") throw new TeamError(409, "この申し込みはすでに取り消されています");

  return { entry, tournament, isAssociationAdmin };
}

// 変更履歴に残す内容（§5.5(d)）。**生年月日・年齢は入れない**（§5.16）
async function snapshotOf(tx: Tx, associationId: string, entry: Entry): Promise<Record<string, unknown>> {
  const players = await listEntryPlayers(tx, associationId, entry.id);
  return {
    categoryId: entry.categoryId,
    teamName: entry.teamName,
    note: entry.note,
    status: entry.status,
    players: players.map((player) => ({ position: player.position, name: player.name })),
  };
}

export async function updateEntry(
  db: Db,
  principal: Principal,
  associationId: string,
  entryId: string,
  raw: Record<string, unknown>,
  now: Date = new Date(),
): Promise<UpdateEntryResult> {
  if (!principal.userId) throw new TeamError(403, "ログインが必要です");
  const userId = principal.userId;

  const parsed = parseEntryEditInput(raw);
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  const input = parsed.value;

  const slots = Array.isArray(raw.slots) ? (raw.slots as PlayerSlot[]) : [];
  const parsedSlots = parsePlayerSlots(slots, todayInTokyo(now));
  if (!parsedSlots.ok) {
    const first = parsedSlots.issues[0];
    throw new TeamError(400, first.message, { field: "slots", playerIndex: first.index, playerField: first.field });
  }
  const players = parsedSlots.players;

  const membership = await getMembership(principal, associationId);
  const isAssociationAdmin = resolveRole(principal, membership, { associationId }) === "association_admin";

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { entry, tournament } = await authorizeEntryChange(tx, { ...principal, userId }, associationId, entryId, isAssociationAdmin, now);

      // 部を変えるときは、変えた先の部も受付中であること（管理者は締切後も変えられる）
      const category = await findTournamentCategory(tx, associationId, entry.tournamentId, input.categoryId);
      if (!category) throw new TeamError(404, "部が見つかりません");
      if (!isAssociationAdmin && entryState(tournament, category, now) !== "open") {
        throw new TeamError(409, "この部の申し込みは締め切りました", { field: "categoryId" });
      }

      // 人数（大会の下限・上限）
      if (players.length < tournament.teamSizeMin) {
        throw new TeamError(400, `この大会は${tournament.teamSizeMin}人以上で申し込みます`, { field: "slots" });
      }
      if (players.length > tournament.teamSizeMax) {
        throw new TeamError(400, `この大会は${tournament.teamSizeMax}人までです`, { field: "slots" });
      }

      // 部門の資格（§5.5(e)）
      const referenceDate = effectiveAgeReferenceDate(category, tournament);
      const eligibility = validateEligibility(toEligibilityPlayers(players), category, referenceDate);
      if (hasEligibilityError(eligibility)) {
        const error = eligibility.issues.find((issue) => issue.level === "error");
        throw new TeamError(409, error?.message ?? "この部の条件を満たしていません", { field: "slots", playerIndex: error?.playerIndex });
      }

      const before = await snapshotOf(tx, associationId, entry);
      const previousIds = (await listEntryPlayers(tx, associationId, entry.id))
        .map((player) => player.memberId)
        .filter((id): id is string => id !== null);

      // 名寄せは新たに手入力された選手だけ（すでに紐づいている選手は resolveMember が picked で返す・§8.3）
      const resolved = [];
      for (const player of players) {
        const person = { name: player.name, kana: player.kana, birthDate: player.birthDate, sex: player.sex };
        resolved.push({ player, person, ...(await resolveMember(tx, associationId, person, choiceOf(player))) });
      }

      const ids = resolved.map((r) => r.memberId);
      const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
      if (duplicate !== undefined) {
        const at = ids.lastIndexOf(duplicate);
        throw new TeamError(400, `${resolved[at].player.name}さんが 2 回入っています`, { field: "slots", playerIndex: at });
      }

      // 新しく入れた人は、申し込むチームの選手一覧にも加える（§5.5(c) 4）
      for (const r of resolved) {
        if (!(await findActiveTeamMember(tx, associationId, entry.teamId, r.memberId))) {
          await addTeamMember(tx, associationId, entry.teamId, r.memberId);
        }
      }

      const warnings: EntryWarning[] = [];
      for (const found of await listDuplicatePlayersInTournament(tx, associationId, entry.tournamentId, ids, entry.id)) {
        warnings.push({
          kind: "duplicate_player",
          message: `${found.name}さんは、この大会の別の申し込み（${found.teamName}・${found.categoryLabel}）にも登録されています`,
        });
      }
      if (await hasEntryForTeamAndCategory(tx, associationId, entry.tournamentId, entry.teamId, category.id, entry.id)) {
        warnings.push({ kind: "same_category", message: "このチームはこの部にすでに申し込んでいます" });
      }

      const needsAdminCheck = eligibility.needsAdminCheck || resolved.some((r) => r.needsReview);

      // 選手はスナップショットなので、行ごと入れ替える（§5.5「申込はスナップショット」）
      await deleteEntryPlayers(tx, associationId, entry.id);
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
      await updateEntryRow(
        tx,
        associationId,
        entry.id,
        { categoryId: category.id, teamName: input.teamName, note: input.note, needsAdminCheck },
        userId,
        now,
      );

      // 参加回数は差分だけ動かす。外れた人の人物は消さない（§5.5(d)）
      await bumpEntryCounts(tx, associationId, ids.filter((id) => !previousIds.includes(id)), now);
      await unbumpEntryCounts(tx, associationId, previousIds.filter((id) => !ids.includes(id)), now);

      const updated = await findEntry(tx, associationId, entry.id);
      await insertEntryAudit(tx, associationId, {
        entryId: entry.id,
        actorId: userId,
        action: "update",
        before,
        after: updated ? await snapshotOf(tx, associationId, updated) : null,
      });

      // 変更のお知らせは、そのチームの有効な代表者全員へ（§11）
      for (const admin of await listTeamAdmins(tx, associationId, entry.teamId)) {
        await enqueueMail(tx, {
          associationId,
          mailType: "entry_updated",
          toEmail: admin.email,
          userId: admin.userId,
          entryId: entry.id,
          params: { entryId: entry.id },
        });
      }

      return { entryId: entry.id, warnings, needsAdminCheck };
    },
    { userId },
  );
}

// 取消（§5.5(d)）。物理削除はしない。取り消したあとは元に戻せない
export async function cancelEntry(
  db: Db,
  principal: Principal,
  associationId: string,
  entryId: string,
  now: Date = new Date(),
): Promise<{ entryId: string }> {
  if (!principal.userId) throw new TeamError(403, "ログインが必要です");
  const userId = principal.userId;
  const membership = await getMembership(principal, associationId);
  const isAssociationAdmin = resolveRole(principal, membership, { associationId }) === "association_admin";

  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { entry } = await authorizeEntryChange(tx, { ...principal, userId }, associationId, entryId, isAssociationAdmin, now);
      const before = await snapshotOf(tx, associationId, entry);
      await cancelEntryRow(tx, associationId, entry.id, userId, now);
      await insertEntryAudit(tx, associationId, {
        entryId: entry.id,
        actorId: userId,
        action: "cancel",
        before,
        after: { ...before, status: "cancelled" },
      });
      for (const admin of await listTeamAdmins(tx, associationId, entry.teamId)) {
        await enqueueMail(tx, {
          associationId,
          mailType: "entry_cancelled",
          toEmail: admin.email,
          userId: admin.userId,
          entryId: entry.id,
          params: { entryId: entry.id },
        });
      }
      return { entryId: entry.id };
    },
    { userId },
  );
}
