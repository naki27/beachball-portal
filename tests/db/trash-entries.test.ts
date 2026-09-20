import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associationAdmins,
  associations,
  categoryPresets,
  deletionLogs,
  entries,
  entryAudits,
  entryPlayers,
  mailLogs,
  members,
  teams,
  tournaments,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "@/lib/admin/categories";
import { deleteEntryByAdmin } from "@/lib/admin/entries";
import { deleteMemberByAdmin } from "@/lib/admin/members";
import { createTournament, deleteTournament } from "@/lib/admin/tournaments";
import { countTrash, listTrash, purgeFromTrash, restoreFromTrash } from "@/lib/admin/trash";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import type { PlayerSlot } from "@/lib/entries/player-slots";
import { submitEntry } from "@/lib/entries/submit-entry";
import { updateEntry } from "@/lib/entries/update-entry";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 削除済みデータ（大会・部・申込）と、人物を物理削除するときの申込の記録の扱い（設計書 §5.16・B-17）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `ごみ${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const NOW = new Date("2026-09-20T03:00:00Z");

let A = "";
let adminId = "";
let repId = "";
let teamId = "";
const presetIds: Record<string, string> = {};
const roster: { memberId: string; name: string; kana: string; birthDate: string; sex: "male" | "female" }[] = [];

async function statusOf(run: () => Promise<unknown>): Promise<"ok" | number> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

type Player = { memberId: string; name: string; kana: string | null; birthDate: string; sex: "male" | "female" };

const slots = (players: Player[] = roster): PlayerSlot[] =>
  players.map((p) => ({ kind: "pick", memberId: p.memberId, name: p.name, kana: p.kana, birthDate: p.birthDate, sex: p.sex }));

// 物理削除の対象にする人（テストごとに作る。ほかのテストの申込に影響させない）
async function newVictim(name: string): Promise<Player> {
  const { memberId } = await addPlayer(app, as(repId), A, teamId, { name: `${tag} ${name}`, kana: "しょうきょ", birthDate: "1990-01-01", sex: "male" });
  return { memberId, name: `${tag} ${name}`, kana: "しょうきょ", birthDate: "1990-01-01", sex: "male" };
}

// 大会 → 部 → 申込を 1 組作る
async function tournamentWithEntry(
  name: string,
  players: Player[] = roster,
): Promise<{ tournamentId: string; categoryId: string; entryId: string }> {
  const tournament = await createTournament(app, as(adminId), A, {
    name: `${tag} ${name}`,
    eventDate: "2026-11-23",
    ageReferenceDate: "2026-11-23",
    venue: "早良体育館",
    description: "",
    entryStartDate: "2026-09-01",
    entryEndDate: "2026-09-30",
    teamSizeMin: "4",
    teamSizeMax: "7",
    maxEntries: "",
    status: "open",
  });
  await addCategoriesFromPresets(app, as(adminId), A, tournament.id, { presetIds: [presetIds.m_free] });
  const categoryId = (await getCategoriesForAdmin(app, as(adminId), A, tournament.id)).categories[0].id;
  const entry = await submitEntry(
    app,
    as(repId),
    A,
    tournament.id,
    { teamId, newTeamName: "", teamName: `${tag} さくら`, categoryId, slots: slots(players), note: "", token: crypto.randomUUID() },
    NOW,
  );
  return { tournamentId: tournament.id, categoryId, entryId: entry.entryId };
}

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `trash-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `trash-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `trash-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));
  await withTenantOn(owner, A, async (tx) => {
    const rows = await tx
      .insert(categoryPresets)
      .values([{ associationId: A, code: "m_free", labelDefault: "男子フリーの部", gender: "male", ruleType: "free", sortOrder: 10 }])
      .returning({ id: categoryPresets.id, code: categoryPresets.code });
    for (const row of rows) presetIds[row.code] = row.id;
  });

  teamId = (await registerTeam(app, A, repId, { name: `${tag} さくら`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;
  for (const p of [
    { name: `${tag} アキラ`, kana: "あきら", birthDate: "1975-04-01", sex: "male" as const },
    { name: `${tag} イサム`, kana: "いさむ", birthDate: "1978-05-02", sex: "male" as const },
    { name: `${tag} ウシオ`, kana: "うしお", birthDate: "1980-06-03", sex: "male" as const },
    { name: `${tag} エイジ`, kana: "えいじ", birthDate: "1982-07-04", sex: "male" as const },
  ]) {
    const { memberId } = await addPlayer(app, as(repId), A, teamId, p);
    roster.push({ memberId, ...p });
  }
}, 60_000);

afterAll(async () => {
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, A));
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(deletionLogs).where(eq(deletionLogs.associationId, A));
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(associations).where(eq(associations.id, A));
  await owner.delete(users).where(inArray(users.id, [adminId, repId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("大会・申込の削除済みデータ（§5.16）", () => {
  it("大会を削除すると一覧に出て、元に戻せる。代表者は削除できない（403）", async () => {
    const made = await tournamentWithEntry("消す大会");
    expect(await statusOf(() => deleteTournament(app, as(repId), A, made.tournamentId))).toBe(403);

    await deleteTournament(app, as(adminId), A, made.tournamentId);
    const items = await listTrash(app, as(adminId), A, "tournaments");
    expect(items.map((i) => i.id)).toContain(made.tournamentId);
    expect((await countTrash(app, as(adminId), A)).tournaments).toBeGreaterThan(0);

    await restoreFromTrash(app, as(adminId), A, "tournaments", made.tournamentId);
    expect((await listTrash(app, as(adminId), A, "tournaments")).map((i) => i.id)).not.toContain(made.tournamentId);
  });

  it("申込を削除すると一覧に出て、完全に削除すると選手と変更履歴も消える", async () => {
    const made = await tournamentWithEntry("申込を消す大会");
    await updateEntry(
      app,
      as(repId),
      A,
      made.entryId,
      { teamName: `${tag} さくら`, categoryId: made.categoryId, note: "直した", slots: slots() },
      NOW,
    );
    expect(await statusOf(() => deleteEntryByAdmin(app, as(repId), A, made.entryId, NOW))).toBe(403);
    // 論理削除していないものは完全に削除できない
    expect(await statusOf(() => purgeFromTrash(app, as(adminId), A, "entries", made.entryId, "誤登録"))).toBe(409);

    await deleteEntryByAdmin(app, as(adminId), A, made.entryId, NOW);
    expect((await listTrash(app, as(adminId), A, "entries")).map((i) => i.id)).toContain(made.entryId);

    const result = await purgeFromTrash(app, as(adminId), A, "entries", made.entryId, "誤登録", "mistake");
    expect(result.cascadedCount).toBeGreaterThan(0);
    const left = await withTenantOn(owner, A, (tx) => tx.select().from(entries).where(eq(entries.id, made.entryId)));
    expect(left).toHaveLength(0);
    const players = await withTenantOn(owner, A, (tx) =>
      tx.select().from(entryPlayers).where(eq(entryPlayers.entryId, made.entryId)),
    );
    expect(players).toHaveLength(0);
    const audits = await withTenantOn(owner, A, (tx) => tx.select().from(entryAudits).where(eq(entryAudits.entryId, made.entryId)));
    expect(audits).toHaveLength(0);
  });

  it("大会を完全に削除すると、部と申込も消える", async () => {
    const made = await tournamentWithEntry("まるごと消す大会");
    await deleteTournament(app, as(adminId), A, made.tournamentId);
    await purgeFromTrash(app, as(adminId), A, "tournaments", made.tournamentId, "試験のデータ");
    const left = await withTenantOn(owner, A, (tx) =>
      tx.select().from(entries).where(eq(entries.tournamentId, made.tournamentId)),
    );
    expect(left).toHaveLength(0);
  });

  it("申込のあるチームは完全に削除できない", async () => {
    const made = await tournamentWithEntry("チームを消せない大会");
    expect(made.entryId).toBeTruthy();
    // チームを論理削除してから
    await withTenantOn(owner, A, (tx) => tx.update(teams).set({ deletedAt: new Date() }).where(eq(teams.id, teamId)));
    expect(await statusOf(() => purgeFromTrash(app, as(adminId), A, "teams", teamId, "解散"))).toBe(409);
    await withTenantOn(owner, A, (tx) => tx.update(teams).set({ deletedAt: null }).where(eq(teams.id, teamId)));
  });
});

describe("人物の物理削除と申込の記録（§5.16 の受け入れ条件）", () => {
  it("保存期間による削除は、生年月日だけ消して氏名・性別・年齢を残す", async () => {
    const target = await newVictim("保存期間の人");
    const made = await tournamentWithEntry("保存期間の大会", [...roster.slice(0, 3), target]);
    await deleteMemberByAdmin(app, as(adminId), A, target.memberId);
    await purgeFromTrash(app, as(adminId), A, "members", target.memberId, "5 年", "retention");

    const players = await withTenantOn(owner, A, (tx) =>
      tx.select().from(entryPlayers).where(eq(entryPlayers.entryId, made.entryId)),
    );
    expect(players).toHaveLength(4); // 申込の件数・人数は変わらない
    const left = players.find((p) => p.name === target.name);
    expect(left).toBeDefined();
    expect(left?.birthDate).toBeNull();
    expect(left?.memberId).toBeNull();
    expect(left?.sex).toBe("male");
    expect(left?.ageAtEvent).not.toBeNull();
    // 人物そのものは消えている
    const gone = await withTenantOn(owner, A, (tx) => tx.select().from(members).where(eq(members.id, target.memberId)));
    expect(gone).toHaveLength(0);
    // 記録には中身を残さない
    const [log] = await withTenantOn(owner, A, (tx) =>
      tx.select().from(deletionLogs).where(and(eq(deletionLogs.associationId, A), eq(deletionLogs.recordId, target.memberId))),
    );
    expect(log.reason).toContain("保存期間");
    expect(JSON.stringify(log)).not.toContain(target.name);
  });

  it("本人の依頼による削除は、氏名・ふりがなも「（削除済み）」になり、変更履歴の氏名も置き換わる", async () => {
    const target = await newVictim("依頼の人");
    const players = [...roster.slice(0, 3), target];
    const made = await tournamentWithEntry("本人の依頼の大会", players);
    await updateEntry(
      app,
      as(repId),
      A,
      made.entryId,
      { teamName: `${tag} さくら`, categoryId: made.categoryId, note: "変更", slots: slots(players) },
      NOW,
    );
    await deleteMemberByAdmin(app, as(adminId), A, target.memberId);
    await purgeFromTrash(app, as(adminId), A, "members", target.memberId, "本人から依頼", "request");

    const saved = await withTenantOn(owner, A, (tx) =>
      tx.select().from(entryPlayers).where(eq(entryPlayers.entryId, made.entryId)),
    );
    expect(saved).toHaveLength(4);
    expect(saved.some((p) => p.name === target.name)).toBe(false);
    const anonymised = saved.find((p) => p.name === "（削除済み）");
    expect(anonymised).toBeDefined();
    expect(anonymised?.kana).toBeNull();
    expect(anonymised?.birthDate).toBeNull();

    const audits = await withTenantOn(owner, A, (tx) => tx.select().from(entryAudits).where(eq(entryAudits.entryId, made.entryId)));
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(target.name);
    expect(JSON.stringify(audits)).toContain("（削除済み）");
  });
});
