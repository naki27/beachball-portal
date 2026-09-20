import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, categoryPresets, entries, entryPlayers, teams, tournaments, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "@/lib/admin/categories";
import { createTournament, editTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { normalizeName } from "@/lib/normalize";
import { getEntryTeamsForPublic, getTournamentForPublic, listTournamentsForPublic } from "@/lib/public/tournaments";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 公開ページの読み取り（設計書 §5.6・B-06）。未ログインでも見られるが、個人情報は一切返さない
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `公開${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

// 「今日」を 2026-09-20 に固定して判定する（サーバーの TZ に関係なく同じ結果になる）
const NOW = new Date("2026-09-20T03:00:00Z");

const input = (over: Record<string, unknown> = {}) => ({
  name: `${tag} 大会 ${random()}`,
  eventDate: "2026-11-23",
  ageReferenceDate: "2026-11-23",
  venue: "早良体育館",
  description: "参加費 3000円",
  entryStartDate: "2026-09-01",
  entryEndDate: "2026-09-30",
  teamSizeMin: "4",
  teamSizeMax: "7",
  maxEntries: "",
  status: "open",
  ...over,
});

async function statusOf(run: () => Promise<unknown>): Promise<"ok" | number> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

let A = "";
let B = "";
let adminId = "";
let repId = "";
let teamId = "";
let presetId = "";
let openId = "";
let upcomingId = "";
let pastId = "";
let draftId = "";

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `pub-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `pub-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId] = made.map((u) => u.id);

  const rows = await owner
    .insert(associations)
    .values([
      { name: `${tag} 協会`, slug: `pub-a-${random()}` },
      { name: `${tag} 別協会`, slug: `pub-b-${random()}` },
    ])
    .returning({ id: associations.id });
  [A, B] = rows.map((r) => r.id);
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  await withTenantOn(owner, A, async (tx) => {
    const [preset] = await tx
      .insert(categoryPresets)
      .values({ associationId: A, code: "m_40", labelDefault: "男子40歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 40 })
      .returning({ id: categoryPresets.id });
    presetId = preset.id;
  });

  const team = await registerTeam(app, A, repId, {
    name: `${tag} チーム`,
    kana: null,
    contactEmail: "rep@example.com",
    contactPhone: "090-0000-0000",
    membershipRenewalTarget: false,
  });
  teamId = team.id;

  // 受付中・今後・締切後・準備中の 4 つ
  openId = (await createTournament(app, as(adminId), A, input({ name: `${tag} 受付中` }))).id;
  upcomingId = (await createTournament(app, as(adminId), A, input({ name: `${tag} 今後`, entryStartDate: "2026-10-01", entryEndDate: "2026-10-31" }))).id;
  pastId = (await createTournament(app, as(adminId), A, input({ name: `${tag} 締切後`, entryStartDate: "2026-07-01", entryEndDate: "2026-08-31" }))).id;
  draftId = (await createTournament(app, as(adminId), A, input({ name: `${tag} 準備中`, status: "draft" }))).id;
  for (const id of [openId, upcomingId, pastId, draftId]) {
    await addCategoriesFromPresets(app, as(adminId), A, id, { presetIds: [presetId] });
  }

  // 受付中の大会に申込を 1 件（個人情報が公開の応答に混ざらないことを見るため、選手も入れる）
  const view = await getCategoriesForAdmin(app, as(adminId), A, openId);
  const categoryId = view.categories[0].id;
  await withTenantOn(owner, A, async (tx) => {
    const [entry] = await tx
      .insert(entries)
      .values({ associationId: A, tournamentId: openId, categoryId, teamId, createdBy: repId, teamName: `${tag} チーム`, note: "駐車場を使います" })
      .returning({ id: entries.id });
    await tx.insert(entryPlayers).values({
      associationId: A,
      entryId: entry.id,
      position: 1,
      name: "山田太郎",
      birthDate: "1980-05-01",
      sex: "male",
      ageAtEvent: 46,
      nameNormalized: normalizeName("山田太郎"),
    });
  });
});

afterAll(async () => {
  for (const id of [A, B]) {
    await withTenantOn(owner, id, async (tx) => {
      await tx.delete(tournaments).where(eq(tournaments.associationId, id));
      await tx.delete(teams).where(eq(teams.associationId, id));
      await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, id));
      await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, id));
    });
  }
  await owner.delete(associations).where(inArray(associations.id, [A, B]));
  await owner.delete(users).where(inArray(users.id, [adminId, repId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("大会一覧（§5.6）", () => {
  it("準備中の大会は出さず、受付中・今後・終了に分かれる", async () => {
    const list = await listTournamentsForPublic(app, A, NOW);
    const ids = [...list.open, ...list.upcoming, ...list.past].map((t) => t.id);
    expect(ids).not.toContain(draftId);
    expect(list.open.map((t) => t.id)).toEqual([openId]);
    expect(list.upcoming.map((t) => t.id)).toEqual([upcomingId]);
    expect(list.past.map((t) => t.id)).toEqual([pastId]);
    // 「あと◯日」（9/20 から 9/30 まで）
    expect(list.open[0].daysLeft).toBe(10);
    expect(list.open[0].teams).toBe(1);
  });

  it("手で締め切った大会（closed）は、締切前でも終了の側に入る", async () => {
    await editTournament(app, as(adminId), A, upcomingId, input({ name: `${tag} 今後`, entryStartDate: "2026-10-01", entryEndDate: "2026-10-31", status: "closed" }));
    const list = await listTournamentsForPublic(app, A, NOW);
    expect(list.past.map((t) => t.id)).toContain(upcomingId);
    await editTournament(app, as(adminId), A, upcomingId, input({ name: `${tag} 今後`, entryStartDate: "2026-10-01", entryEndDate: "2026-10-31" }));
  });
});

describe("大会詳細（§4.2 #6）", () => {
  it("部の条件の文章と有効な基準日が付く", async () => {
    const tournament = await getTournamentForPublic(app, A, openId, NOW);
    expect(tournament.categories).toHaveLength(1);
    expect(tournament.categories[0].condition).toContain("40歳以上");
    expect(tournament.categories[0].ageReferenceDate).toEqual({ year: 2026, month: 11, day: 23 });
    expect(tournament.categories[0].state).toBe("open");
  });

  it("準備中の大会・別の協会の大会・でたらめな ID は 404", async () => {
    expect(await statusOf(() => getTournamentForPublic(app, A, draftId, NOW))).toBe(404);
    expect(await statusOf(() => getTournamentForPublic(app, B, openId, NOW))).toBe(404);
    expect(await statusOf(() => getTournamentForPublic(app, A, "こわれた-id", NOW))).toBe(404);
    expect(await statusOf(() => getEntryTeamsForPublic(app, A, draftId, NOW))).toBe(404);
  });
});

describe("参加チーム一覧（§5.6 受け入れ条件）", () => {
  it("部とチーム名とチーム数だけを返し、個人情報は 1 つも含まない", async () => {
    const result = await getEntryTeamsForPublic(app, A, openId, NOW);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].teams).toEqual([`${tag} チーム`]);
    expect(result.tournament.teams).toBe(1);

    // 応答を丸ごと文字列にして、選手名・生年月日・年齢・性別・連絡先・備考が混ざっていないことを見る
    const json = JSON.stringify(result);
    for (const secret of ["山田太郎", "1980-05-01", "1980", "male", "rep@example.com", "090-0000-0000", "駐車場"]) {
      expect(json).not.toContain(secret);
    }
    // 大会詳細の応答にも混ざらない
    const detail = JSON.stringify(await getTournamentForPublic(app, A, openId, NOW));
    for (const secret of ["山田太郎", "1980-05-01", "rep@example.com", "090-0000-0000", "駐車場"]) {
      expect(detail).not.toContain(secret);
    }
  });
});
