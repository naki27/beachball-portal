import type { Db } from "@/db/client";
import { type Tx, withTenantOn } from "@/db/tenant";
import { daysUntilDeadline, effectiveAgeReferenceDate, effectiveDeadline, type EntryState, entryState, tournamentEntryState } from "@/lib/deadline";
import type { PlainDate } from "@/lib/date";
import type { DocType } from "@/lib/documents/document-input";
import { shouldBePublic } from "@/lib/documents/publish";
import { isUuid } from "@/lib/ids";
import { countEntriesByTournament, listPublicEntryTeams } from "@/lib/repo/entries";
import { listTournamentCategories, type TournamentCategory } from "@/lib/repo/tournament-categories";
import { findTournamentDocument, listTournamentDocuments } from "@/lib/repo/tournament-documents";
import { findPublicTournament, listPublicTournaments, type Tournament } from "@/lib/repo/tournaments";
import { TeamError } from "@/lib/teams/errors";
import type { StorageAdapter } from "@/lib/storage/types";
import { categoryConditionText } from "@/lib/tournaments/category-text";

// 公開ページの読み取り（設計書 §5.6）。ログインしていなくても見られる。準備中（draft）の大会は 404
//
// **この層が返す形（下の型）に、選手の情報を入れない**。氏名・生年月日・年齢・性別・メール・電話は
// 画面でも API でも公開の応答に載せない（§5.6 受け入れ条件）。出すのは部・チーム名・チーム数だけ

export type PublicCategory = {
  id: string;
  label: string;
  condition: string; // 部の条件の文章（category-text.ts）
  entryEndAt: Date; // 有効な締切（部 → 大会）
  ageReferenceDate: PlainDate; // 有効な基準日（部 → 大会）
  overridesDeadline: boolean; // 大会の締切と違うか（違う部があるときだけ部ごとの締切を出す・追加仕様 2）
  state: EntryState;
  teams: number;
};

export type PublicTournament = {
  id: string;
  name: string;
  eventDate: PlainDate | null;
  venue: string | null;
  description: string | null;
  ageReferenceDate: PlainDate;
  teamSizeMin: number;
  teamSizeMax: number;
  entryStartAt: Date | null;
  entryEndAt: Date;
  state: EntryState;
  daysLeft: number; // 締切まであと何日（当日は 0・過ぎていれば負）
  categories: PublicCategory[];
  teams: number;
};

export type PublicTournamentList = {
  open: PublicTournament[]; // 受付中
  upcoming: PublicTournament[]; // 今後の大会（受付はまだ始まっていない）
  past: PublicTournament[]; // 締切後・終了した大会
};

function toPublicCategory(category: TournamentCategory, tournament: Tournament, teams: number, now: Date): PublicCategory {
  const reference = effectiveAgeReferenceDate(category, tournament);
  return {
    id: category.id,
    label: category.label,
    condition: categoryConditionText(category, reference),
    entryEndAt: effectiveDeadline(category, tournament),
    ageReferenceDate: reference,
    overridesDeadline: category.entryEndAt !== null,
    state: entryState(tournament, category, now),
    teams,
  };
}

function toPublicTournament(tournament: Tournament, categories: PublicCategory[], teams: number, now: Date): PublicTournament {
  const state = tournamentEntryState(
    tournament,
    categories.map((c) => ({ entryEndAt: c.entryEndAt })),
    now,
  );
  // 「あと◯日」は、いちばん遅い締切まで（部ごとに締切が違う大会でも 1 つの数字で出す）
  const latest = categories.reduce((max, c) => (c.entryEndAt > max ? c.entryEndAt : max), tournament.entryEndAt);
  return {
    id: tournament.id,
    name: tournament.name,
    eventDate: tournament.eventDate,
    venue: tournament.venue,
    description: tournament.description,
    ageReferenceDate: tournament.ageReferenceDate,
    teamSizeMin: tournament.teamSizeMin,
    teamSizeMax: tournament.teamSizeMax,
    entryStartAt: tournament.entryStartAt,
    entryEndAt: tournament.entryEndAt,
    state,
    daysLeft: daysUntilDeadline(latest, now),
    categories,
    teams,
  };
}

// 協会のトップ・大会一覧。状態ごとに分ける（§5.6・§4.2 #1）
export async function listTournamentsForPublic(db: Db, associationId: string, now: Date = new Date()): Promise<PublicTournamentList> {
  return withTenantOn(db, associationId, async (tx) => {
    const tournaments = await listPublicTournaments(tx, associationId);
    const counts = await countEntriesByTournament(
      tx,
      associationId,
      tournaments.map((t) => t.id),
    );
    const rows: PublicTournament[] = [];
    for (const tournament of tournaments) {
      const categories = await listTournamentCategories(tx, associationId, tournament.id);
      rows.push(
        toPublicTournament(
          tournament,
          categories.map((c) => toPublicCategory(c, tournament, 0, now)),
          counts.get(tournament.id) ?? 0,
          now,
        ),
      );
    }
    return {
      open: rows.filter((t) => t.state === "open"),
      upcoming: rows.filter((t) => t.state === "not_started"),
      past: rows.filter((t) => t.state !== "open" && t.state !== "not_started"),
    };
  });
}

async function loadPublic(tx: Tx, associationId: string, tournamentId: string, now: Date): Promise<{ tournament: Tournament; view: PublicTournament }> {
  if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
  const tournament = await findPublicTournament(tx, associationId, tournamentId);
  if (!tournament) throw new TeamError(404, "大会が見つかりません");
  const categories = await listTournamentCategories(tx, associationId, tournamentId);
  const teams = await listPublicEntryTeams(tx, associationId, tournamentId);
  const byCategory = new Map<string, number>();
  for (const team of teams) byCategory.set(team.categoryId, (byCategory.get(team.categoryId) ?? 0) + 1);
  const view = toPublicTournament(
    tournament,
    categories.map((c) => toPublicCategory(c, tournament, byCategory.get(c.id) ?? 0, now)),
    teams.length,
    now,
  );
  return { tournament, view };
}

// 大会詳細（§4.2 #6）
export async function getTournamentForPublic(db: Db, associationId: string, tournamentId: string, now: Date = new Date()): Promise<PublicTournament> {
  return withTenantOn(db, associationId, async (tx) => (await loadPublic(tx, associationId, tournamentId, now)).view);
}

// 参加チーム一覧（§4.2 #10）。部ごとのチーム名とチーム数だけを返す
export type PublicEntryGroup = { categoryId: string; label: string; teams: string[] };

export async function getEntryTeamsForPublic(
  db: Db,
  associationId: string,
  tournamentId: string,
  now: Date = new Date(),
): Promise<{ tournament: PublicTournament; groups: PublicEntryGroup[] }> {
  return withTenantOn(db, associationId, async (tx) => {
    const { view } = await loadPublic(tx, associationId, tournamentId, now);
    const teams = await listPublicEntryTeams(tx, associationId, tournamentId);
    const groups = view.categories.map((category) => ({
      categoryId: category.id,
      label: category.label,
      teams: teams.filter((t) => t.categoryId === category.id).map((t) => t.teamName),
    }));
    return { tournament: view, groups };
  });
}

// 公開されている資料（§5.9）。公開用に置かれているものだけ。出すのは種別・タイトル・大きさだけ
export type PublicDocument = { id: string; docType: DocType; title: string; sizeBytes: number };

export async function listDocumentsForPublic(db: Db, associationId: string, tournamentId: string): Promise<PublicDocument[]> {
  return withTenantOn(db, associationId, async (tx) => {
    if (!isUuid(tournamentId)) throw new TeamError(404, "大会が見つかりません");
    const tournament = await findPublicTournament(tx, associationId, tournamentId);
    if (!tournament) throw new TeamError(404, "大会が見つかりません");
    const documents = await listTournamentDocuments(tx, associationId, tournamentId);
    return documents
      .filter((document) => shouldBePublic(document, tournament) && document.publicKey !== null)
      .map((document) => ({ id: document.id, docType: document.docType, title: document.title, sizeBytes: document.sizeBytes }));
  });
}

// アプリの URL（利用者が共有するのはこちら・期限なし）から公開用の URL を引く。開けない資料は null
// 非公開・削除済み・大会が draft のときは null（呼ぶ側が 404 にする）
export async function findPublicDocumentUrl(
  db: Db,
  associationId: string,
  tournamentId: string,
  documentId: string,
  storage: StorageAdapter,
): Promise<string | null> {
  if (!isUuid(tournamentId) || !isUuid(documentId)) return null;
  return withTenantOn(db, associationId, async (tx) => {
    const tournament = await findPublicTournament(tx, associationId, tournamentId);
    if (!tournament) return null;
    const document = await findTournamentDocument(tx, associationId, tournamentId, documentId);
    if (!document || !document.publicKey || !shouldBePublic(document, tournament)) return null;
    return storage.publicUrl(document.publicKey);
  });
}
