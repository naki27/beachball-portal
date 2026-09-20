import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, categoryPresets, mailLogs, members, teams, tournaments, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "@/lib/admin/categories";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { entryTodos, listMyEntries } from "@/lib/entries/my-entries";
import type { PlayerSlot } from "@/lib/entries/player-slots";
import { submitEntry } from "@/lib/entries/submit-entry";
import { cancelEntry } from "@/lib/entries/update-entry";
import { setMemberUser } from "@/lib/repo/members";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// マイページの申込と「あなたのやること」（設計書 §5.3・§5.17・B-16）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `自分${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const NOW = new Date("2026-09-20T03:00:00Z");

let A = "";
let adminId = "";
let repId = "";
let playerUserId = "";
let teamId = "";
let openId = "";
let categoryId = "";
const presetIds: Record<string, string> = {};
const roster: { memberId: string; name: string; kana: string; birthDate: string; sex: "male" | "female" }[] = [];

const slots = (): PlayerSlot[] =>
  roster.map((p) => ({ kind: "pick", memberId: p.memberId, name: p.name, kana: p.kana, birthDate: p.birthDate, sex: p.sex }));

const submitBody = (over: Record<string, unknown> = {}) => ({
  teamId,
  newTeamName: "",
  teamName: `${tag} さくら`,
  categoryId,
  slots: slots(),
  note: "",
  token: crypto.randomUUID(),
  ...over,
});

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `my-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `my-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `my-player-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId, playerUserId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `my-${random()}` })
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
  // 選手の 1 人にアカウントを紐づける（招待の承諾と同じ状態・§5.15）
  await withTenantOn(app, A, (tx) => setMemberUser(tx, A, roster[0].memberId, playerUserId));

  openId = (
    await createTournament(app, as(adminId), A, {
      name: `${tag} 受付中の大会`,
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
  await addCategoriesFromPresets(app, as(adminId), A, openId, { presetIds: [presetIds.m_free] });
  categoryId = (await getCategoriesForAdmin(app, as(adminId), A, openId)).categories[0].id;
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
  await owner.delete(users).where(inArray(users.id, [adminId, repId, playerUserId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("マイページの申込（§5.3）", () => {
  it("代表者には操作できる申込、選手には自分が出る申込が出る", async () => {
    const entry = await submitEntry(app, as(repId), A, openId, submitBody(), NOW);

    const rep = await listMyEntries(app, as(repId), A);
    expect(rep.managed.map((e) => e.entryId)).toContain(entry.entryId);
    expect(rep.managed.find((e) => e.entryId === entry.entryId)?.canManage).toBe(true);
    expect(rep.asPlayer).toEqual([]);

    const player = await listMyEntries(app, as(playerUserId), A);
    expect(player.managed).toEqual([]);
    expect(player.asPlayer.map((e) => e.entryId)).toContain(entry.entryId);
    expect(player.asPlayer[0].canManage).toBe(false);
    // 生年月日は出さない
    expect(JSON.stringify(player.asPlayer)).not.toContain("1975-04-01");

    // 未ログインは空
    expect(await listMyEntries(app, ANONYMOUS, A)).toEqual({ managed: [], asPlayer: [] });
  });

  it("取り消した申込は、代表者には印つきで残り、選手の一覧からは消える", async () => {
    const entry = await submitEntry(app, as(repId), A, openId, submitBody({ teamName: `${tag} 取り消す` }), NOW);
    await cancelEntry(app, as(repId), A, entry.entryId, NOW);

    const rep = await listMyEntries(app, as(repId), A);
    expect(rep.managed.find((e) => e.entryId === entry.entryId)?.status).toBe("cancelled");
    const player = await listMyEntries(app, as(playerUserId), A);
    expect(player.asPlayer.map((e) => e.entryId)).not.toContain(entry.entryId);
  });
});

describe("あなたのやること（§5.17）", () => {
  const open = [{ id: "t1", name: "秋の大会" }];

  it("まだ申し込んでいない大会と、申し込み済みの大会を出し分ける", () => {
    const notYet = entryTodos("sawara", open, [], true);
    expect(notYet[0].text).toBe("秋の大会の受付中です（まだ申し込んでいません）");
    expect(notYet[0].href).toBe("/sawara/tournaments/t1/entry");

    const done = entryTodos(
      "sawara",
      open,
      [
        {
          entryId: "e1",
          tournamentId: "t1",
          tournamentName: "秋の大会",
          categoryLabel: "男子フリーの部",
          teamId: "team",
          teamName: "さくら",
          status: "submitted",
          deadline: new Date("2026-09-30T14:59:59Z"),
          canManage: true,
        },
      ],
      true,
    );
    expect(done[0].text).toBe("秋の大会に申し込み済みです");
    expect(done[0].href).toBe("/sawara/entries/e1");
  });

  it("代表を務めるチームも個人登録もない人には出さない", () => {
    expect(entryTodos("sawara", open, [], false)).toEqual([]);
  });
});
