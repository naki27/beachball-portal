import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associationAdmins,
  associations,
  categoryPresets,
  entryAudits,
  mailLogs,
  members,
  teams,
  tournaments,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "@/lib/admin/categories";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { endOfDayTokyo } from "@/lib/date";
import { getEntryDetail } from "@/lib/entries/entry-detail";
import type { PlayerSlot } from "@/lib/entries/player-slots";
import { submitEntry } from "@/lib/entries/submit-entry";
import { cancelEntry, updateEntry } from "@/lib/entries/update-entry";
import { findEntry, listEntryPlayers, listPublicEntryTeams } from "@/lib/repo/entries";
import { findMember } from "@/lib/repo/members";
import { listActiveRoster } from "@/lib/repo/team-members";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer, leavePlayer, undoLeave } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 申込の変更・取消（設計書 §5.5(d)・B-12）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `変更${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const NOW = new Date("2026-09-20T03:00:00Z");
// 大会の締切は 2026-09-30 の日本時間 23:59:59.999。その 1 秒後（§5.5(d) の受け入れ条件）
const AFTER_DEADLINE = new Date(endOfDayTokyo({ year: 2026, month: 9, day: 30 }).getTime() + 1_000);

let A = "";
let adminId = "";
let repId = "";
let otherId = "";
let teamId = "";
let openId = "";
const presetIds: Record<string, string> = {};
const categoryIds: Record<string, string> = {};
const roster: { memberId: string; name: string; kana: string; birthDate: string; sex: "male" | "female" }[] = [];

const pickSlot = (index: number): PlayerSlot => {
  const p = roster[index];
  return { kind: "pick", memberId: p.memberId, name: p.name, kana: p.kana, birthDate: p.birthDate, sex: p.sex };
};

const submitBody = (over: Record<string, unknown> = {}) => ({
  teamId,
  newTeamName: "",
  teamName: `${tag} さくら`,
  categoryId: categoryIds.m_free,
  slots: [pickSlot(0), pickSlot(1), pickSlot(2), pickSlot(3)],
  note: "",
  token: crypto.randomUUID(),
  ...over,
});

const editBody = (over: Record<string, unknown> = {}) => ({
  teamName: `${tag} さくら`,
  categoryId: categoryIds.m_free,
  note: "",
  slots: [pickSlot(0), pickSlot(1), pickSlot(2), pickSlot(3)],
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

const newEntry = () => submitEntry(app, as(repId), A, openId, submitBody(), NOW);

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `upd-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `upd-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `upd-other-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId, otherId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `upd-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  await withTenantOn(owner, A, async (tx) => {
    const rows = await tx
      .insert(categoryPresets)
      .values([
        { associationId: A, code: "m_free", labelDefault: "男子フリーの部", gender: "male", ruleType: "free", sortOrder: 10 },
        { associationId: A, code: "m_60", labelDefault: "男子60歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 60, sortOrder: 20 },
      ])
      .returning({ id: categoryPresets.id, code: categoryPresets.code });
    for (const row of rows) presetIds[row.code] = row.id;
  });

  teamId = (await registerTeam(app, A, repId, { name: `${tag} さくら`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;

  for (const p of [
    { name: `${tag} アキラ`, kana: "あきら", birthDate: "1975-04-01", sex: "male" as const },
    { name: `${tag} イサム`, kana: "いさむ", birthDate: "1978-05-02", sex: "male" as const },
    { name: `${tag} ウシオ`, kana: "うしお", birthDate: "1980-06-03", sex: "male" as const },
    { name: `${tag} エイジ`, kana: "えいじ", birthDate: "1982-07-04", sex: "male" as const },
    { name: `${tag} オサム`, kana: "おさむ", birthDate: "1984-08-05", sex: "male" as const },
  ]) {
    const { memberId } = await addPlayer(app, as(repId), A, teamId, p);
    roster.push({ memberId, ...p });
  }

  openId = (
    await createTournament(app, as(adminId), A, {
      name: `${tag} 受付中`,
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
    })
  ).id;
  await addCategoriesFromPresets(app, as(adminId), A, openId, { presetIds: [presetIds.m_free, presetIds.m_60] });
  const view = await getCategoriesForAdmin(app, as(adminId), A, openId);
  for (const category of view.categories) categoryIds[category.code] = category.id;
}, 60_000);

afterAll(async () => {
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, A));
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(associations).where(eq(associations.id, A));
  await owner.delete(users).where(inArray(users.id, [adminId, repId, otherId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("締切と権限（§5.5(d) の受け入れ条件）", () => {
  it("締切 1 秒後は、代表者は 409・代表者でない人は 403・管理者は成功して entry_audits に 1 件", async () => {
    const entry = await newEntry();
    expect(await statusOf(() => updateEntry(app, as(repId), A, entry.entryId, editBody(), AFTER_DEADLINE))).toBe(409);
    expect(await statusOf(() => updateEntry(app, as(otherId), A, entry.entryId, editBody(), AFTER_DEADLINE))).toBe(403);
    expect(await statusOf(() => updateEntry(app, ANONYMOUS, A, entry.entryId, editBody(), AFTER_DEADLINE))).toBe(403);

    const auditsOf = (entryId: string) =>
      withTenantOn(owner, A, (tx) => tx.select().from(entryAudits).where(eq(entryAudits.entryId, entryId)));
    const before = await auditsOf(entry.entryId);
    await updateEntry(app, as(adminId), A, entry.entryId, editBody({ note: "運営が代理で直しました" }), AFTER_DEADLINE);
    const after = await auditsOf(entry.entryId);
    expect(after.length - before.length).toBe(1);
    expect(after[after.length - 1].action).toBe("update");
    expect(after[after.length - 1].actorId).toBe(adminId);
    // 履歴に生年月日を入れない（§5.16）
    expect(JSON.stringify(after[after.length - 1])).not.toContain("1975-04-01");

    const row = await withTenantOn(app, A, (tx) => findEntry(tx, A, entry.entryId));
    expect(row?.updatedBy).toBe(adminId);
    expect(row?.note).toBe("運営が代理で直しました");
  });

  it("締切前は代表者が何度でも変えられる。でたらめな ID は 404", async () => {
    const entry = await newEntry();
    await updateEntry(app, as(repId), A, entry.entryId, editBody({ note: "1 回目" }), NOW);
    await updateEntry(app, as(repId), A, entry.entryId, editBody({ note: "2 回目" }), NOW);
    const row = await withTenantOn(app, A, (tx) => findEntry(tx, A, entry.entryId));
    expect(row?.note).toBe("2 回目");
    expect(await statusOf(() => updateEntry(app, as(repId), A, crypto.randomUUID(), editBody(), NOW))).toBe(404);
  });
});

describe("変更の内容（§5.5(d)）", () => {
  it("選手を入れ替えると entry_players が作り直され、外れた人の参加回数だけ戻る（人物は消さない）", async () => {
    const entry = await newEntry();
    const dropped = roster[3];
    const addedId = roster[4].memberId;
    const countBefore = (await withTenantOn(app, A, (tx) => findMember(tx, A, dropped.memberId)))?.entryCount ?? 0;

    await updateEntry(app, as(repId), A, entry.entryId, editBody({ slots: [pickSlot(0), pickSlot(1), pickSlot(2), pickSlot(4)] }), NOW);

    const players = await withTenantOn(app, A, (tx) => listEntryPlayers(tx, A, entry.entryId));
    expect(players.map((p) => p.position)).toEqual([1, 2, 3, 4]);
    expect(players[3].memberId).toBe(addedId);
    const after = await withTenantOn(app, A, (tx) => findMember(tx, A, dropped.memberId));
    expect(after).not.toBeNull();
    expect(after?.entryCount).toBe(Math.max(countBefore - 1, 0));
  });

  it("変更のたびに、そのチームの代表者へ変更のメールを積む（§11）", async () => {
    const entry = await newEntry();
    await updateEntry(app, as(repId), A, entry.entryId, editBody({ note: "駐車場を使います" }), NOW);
    const queued = await owner
      .select()
      .from(mailLogs)
      .where(and(eq(mailLogs.entryId, entry.entryId), eq(mailLogs.mailType, "entry_updated")));
    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe("queued");
  });

  it("選手一覧からいなくなった人には印が付く（申込の内容は変わらない・§5.5）", async () => {
    const entry = await newEntry();
    const left = roster[2];
    const teamMember = await withTenantOn(app, A, async (tx) =>
      (await listActiveRoster(tx, A, teamId)).find((row) => row.memberId === left.memberId),
    );
    if (!teamMember) throw new Error("選手がいません");
    await leavePlayer(app, as(repId), A, teamId, teamMember.teamMemberId);

    const detail = await getEntryDetail(app, as(repId), A, entry.entryId, NOW);
    expect(detail.players.find((p) => p.name === left.name)?.missingFromRoster).toBe(true);
    expect(detail.players).toHaveLength(4); // 申込の内容はそのまま
    // 元に戻す（あとのテストに響かないように）
    await undoLeave(app, as(repId), A, teamId, teamMember.teamMemberId);
  });
});

describe("取消（§5.5(d)）", () => {
  it("取り消すと status が cancelled になり、参加チーム一覧に出ない。取消のメールを積む", async () => {
    const entry = await submitEntry(app, as(repId), A, openId, submitBody({ teamName: `${tag} 取り消す` }), NOW);
    await cancelEntry(app, as(repId), A, entry.entryId, NOW);

    const row = await withTenantOn(app, A, (tx) => findEntry(tx, A, entry.entryId));
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelledAt).not.toBeNull();
    expect(row?.deletedAt).toBeNull(); // 物理削除も論理削除もしない

    const teamsOnPage = await withTenantOn(app, A, (tx) => listPublicEntryTeams(tx, A, openId));
    expect(teamsOnPage.some((t) => t.teamName === `${tag} 取り消す`)).toBe(false);

    const queued = await owner
      .select()
      .from(mailLogs)
      .where(and(eq(mailLogs.entryId, entry.entryId), eq(mailLogs.mailType, "entry_cancelled")));
    expect(queued).toHaveLength(1);
  });

  it("取り消した申込は、もう変更も取消もできない（元に戻せない）", async () => {
    const entry = await newEntry();
    await cancelEntry(app, as(repId), A, entry.entryId, NOW);
    expect(await statusOf(() => cancelEntry(app, as(repId), A, entry.entryId, NOW))).toBe(409);
    expect(await statusOf(() => updateEntry(app, as(repId), A, entry.entryId, editBody(), NOW))).toBe(409);
    const detail = await getEntryDetail(app, as(repId), A, entry.entryId, NOW);
    expect(detail.canEdit).toBe(false);
  });

  it("締切後は代表者が取り消せない（409）。管理者はできる", async () => {
    const entry = await newEntry();
    expect(await statusOf(() => cancelEntry(app, as(repId), A, entry.entryId, AFTER_DEADLINE))).toBe(409);
    await cancelEntry(app, as(adminId), A, entry.entryId, AFTER_DEADLINE);
    const row = await withTenantOn(app, A, (tx) => findEntry(tx, A, entry.entryId));
    expect(row?.status).toBe("cancelled");
  });
});
