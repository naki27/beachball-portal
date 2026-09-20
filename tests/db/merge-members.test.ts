import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  adminAccessLogs,
  associationAdmins,
  associations,
  categoryPresets,
  mailLogs,
  members,
  memberships,
  teamInvitations,
  teams,
  tournaments,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "@/lib/admin/categories";
import { getMergeView, listNeedsReview, mergeMembers, resolveAsDifferentPerson } from "@/lib/admin/merge-members";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { submitEntry } from "@/lib/entries/submit-entry";
import { listEntryPlayers } from "@/lib/repo/entries";
import { findMember, updateMemberStatus } from "@/lib/repo/members";
import { listActiveRoster } from "@/lib/repo/team-members";
import { suggestMembers } from "@/lib/search/suggest-members";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 要確認の解消と、2 つの人物をまとめる（設計書 §5.8・B-15）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `統合${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const NOW = new Date("2026-09-20T03:00:00Z");
const YEAR = 2026;

let A = "";
let adminId = "";
let repId = "";
let personUserId = "";
let teamXId = "";
let teamYId = "";
let openId = "";
let categoryId = "";
const presetIds: Record<string, string> = {};

async function statusOf(run: () => Promise<unknown>): Promise<"ok" | number> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

// 同じ人が二重に登録された状態を作る（氏名は同じ、生年月日が違う）
async function twoRegistrations(name: string): Promise<{ keepId: string; removeId: string }> {
  const keep = await addPlayer(app, as(repId), A, teamXId, { name, kana: "さわら たろう", birthDate: "1980-04-01", sex: "male" });
  const remove = await addPlayer(app, as(repId), A, teamYId, { name, kana: "さわら たろう", birthDate: "1980-04-02", sex: "male" });
  await withTenantOn(app, A, (tx) => updateMemberStatus(tx, A, remove.memberId, "needs_review"));
  return { keepId: keep.memberId, removeId: remove.memberId };
}

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `mrg-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `mrg-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `mrg-person-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId, personUserId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `mrg-${random()}` })
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

  const team = (name: string) => ({ name, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false });
  teamXId = (await registerTeam(app, A, repId, team(`${tag} さくら`))).id;
  teamYId = (await registerTeam(app, A, repId, team(`${tag} つばき`), { confirmSameName: true })).id;

  openId = (
    await createTournament(app, as(adminId), A, {
      name: `${tag} 大会`,
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
  await owner.delete(adminAccessLogs).where(eq(adminAccessLogs.associationId, A));
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(memberships).where(eq(memberships.associationId, A));
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(teamInvitations).where(eq(teamInvitations.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(associations).where(eq(associations.id, A));
  await owner.delete(users).where(inArray(users.id, [adminId, repId, personUserId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("確認が必要の一覧と比較（§5.8）", () => {
  it("テナント管理者だけが見られる。同じ氏名の登録が横に並ぶ", async () => {
    const { keepId, removeId } = await twoRegistrations(`${tag} 早良 一郎`);
    expect(await statusOf(() => listNeedsReview(app, as(repId), A, NOW))).toBe(403);

    const list = await listNeedsReview(app, as(adminId), A, NOW);
    expect(list.map((m) => m.id)).toContain(removeId);

    const view = await getMergeView(app, as(adminId), A, removeId, NOW);
    expect(view.candidates.map((c) => c.id)).toContain(keepId);
    expect(view.candidates.find((c) => c.id === keepId)?.sameName).toBe(true);
  });

  it("「別の人です」で確認の印が外れる", async () => {
    const { removeId } = await twoRegistrations(`${tag} 早良 二郎`);
    await resolveAsDifferentPerson(app, as(adminId), A, removeId);
    const after = await withTenantOn(app, A, (tx) => findMember(tx, A, removeId));
    expect(after?.status).toBe("active");
    // 二度目は 409（もう確認済み）
    expect(await statusOf(() => resolveAsDifferentPerson(app, as(adminId), A, removeId))).toBe(409);
    expect(await statusOf(() => resolveAsDifferentPerson(app, as(repId), A, removeId))).toBe(403);
  });
});

describe("まとめる（§5.8 の受け入れ条件）", () => {
  it("選手一覧・会員資格・申込の紐づけが残す側に移り、消える側は merged になってサジェストに出ない", async () => {
    const { keepId, removeId } = await twoRegistrations(`${tag} 早良 三郎`);
    // 消える側に会員資格と申込を作る
    await withTenantOn(owner, A, (tx) =>
      tx.insert(memberships).values({ associationId: A, memberId: removeId, year: YEAR, status: "approved", source: "renewal" }),
    );
    const others = await Promise.all(
      ["四郎", "五郎", "六郎"].map((name) =>
        addPlayer(app, as(repId), A, teamYId, { name: `${tag} 早良 ${name}`, kana: null, birthDate: "1985-01-01", sex: "male" }),
      ),
    );
    const entry = await submitEntry(
      app,
      as(repId),
      A,
      openId,
      {
        teamId: teamYId,
        newTeamName: "",
        teamName: `${tag} つばき`,
        categoryId,
        slots: [
          { kind: "pick", memberId: removeId, name: `${tag} 早良 三郎`, kana: "さわら たろう", birthDate: "1980-04-02", sex: "male" },
          ...others.map((o, i) => ({
            kind: "pick" as const,
            memberId: o.memberId,
            name: `${tag} 早良 ${["四郎", "五郎", "六郎"][i]}`,
            kana: null,
            birthDate: "1985-01-01",
            sex: "male" as const,
          })),
        ],
        note: "",
        token: crypto.randomUUID(),
      },
      NOW,
    );

    await mergeMembers(app, as(adminId), A, keepId, removeId, NOW);

    // 選手一覧（消える側がいたチームに残す側が移っている）
    const rosterY = await withTenantOn(app, A, (tx) => listActiveRoster(tx, A, teamYId));
    expect(rosterY.map((r) => r.memberId)).toContain(keepId);
    expect(rosterY.map((r) => r.memberId)).not.toContain(removeId);

    // 会員資格
    const yearRows = await withTenantOn(owner, A, (tx) =>
      tx.select().from(memberships).where(and(eq(memberships.associationId, A), eq(memberships.year, YEAR), eq(memberships.memberId, keepId))),
    );
    expect(yearRows).toHaveLength(1);
    expect(yearRows[0].status).toBe("approved");

    // 申込の選手の紐づけ（氏名のスナップショットは変えない）
    const players = await withTenantOn(app, A, (tx) => listEntryPlayers(tx, A, entry.entryId));
    const moved = players.find((p) => p.name === `${tag} 早良 三郎`);
    expect(moved?.memberId).toBe(keepId);

    // 消える側は merged（行は残る）。参加回数は数え直す
    const removed = await withTenantOn(app, A, (tx) => findMember(tx, A, removeId));
    expect(removed?.status).toBe("merged");
    expect(removed?.mergedIntoId).toBe(keepId);
    const kept = await withTenantOn(app, A, (tx) => findMember(tx, A, keepId));
    expect(kept?.status).toBe("active");
    expect(kept?.entryCount).toBe(1);

    // サジェストには残す側だけ
    const found = await suggestMembers(app, A, repId, { q: `${tag} 早良 三郎`, membersOnly: false, year: YEAR });
    expect(found.map((m) => m.memberId)).toContain(keepId);
    expect(found.map((m) => m.memberId)).not.toContain(removeId);

    // 記録が残る
    const logs = await owner
      .select()
      .from(adminAccessLogs)
      .where(and(eq(adminAccessLogs.associationId, A), eq(adminAccessLogs.targetId, removeId)));
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("merge_members");
    expect(logs[0].userId).toBe(adminId);
  });

  it("両方が別のアカウントに紐づいているとまとめられない（409）。片方だけなら残す側に移る", async () => {
    const { keepId, removeId } = await twoRegistrations(`${tag} 早良 七郎`);
    await withTenantOn(owner, A, async (tx) => {
      await tx.update(members).set({ userId: adminId }).where(eq(members.id, keepId));
      await tx.update(members).set({ userId: personUserId }).where(eq(members.id, removeId));
    });
    expect(await statusOf(() => mergeMembers(app, as(adminId), A, keepId, removeId, NOW))).toBe(409);

    // 残す側の紐づけを外せばまとめられ、アカウントは残す側に移る
    await withTenantOn(owner, A, (tx) => tx.update(members).set({ userId: null }).where(eq(members.id, keepId)));
    await mergeMembers(app, as(adminId), A, keepId, removeId, NOW);
    const kept = await withTenantOn(app, A, (tx) => findMember(tx, A, keepId));
    expect(kept?.userId).toBe(personUserId);
    const removed = await withTenantOn(app, A, (tx) => findMember(tx, A, removeId));
    expect(removed?.userId).toBeNull();
  });

  it("同じチームに両方いたら、残す側だけになる。代表者はまとめられない（403）", async () => {
    const name = `${tag} 早良 八郎`;
    const keep = await addPlayer(app, as(repId), A, teamXId, { name, kana: null, birthDate: "1981-04-01", sex: "male" });
    const remove = await addPlayer(app, as(repId), A, teamXId, { name, kana: null, birthDate: "1981-04-02", sex: "male" });

    expect(await statusOf(() => mergeMembers(app, as(repId), A, keep.memberId, remove.memberId, NOW))).toBe(403);

    await mergeMembers(app, as(adminId), A, keep.memberId, remove.memberId, NOW);
    const roster = await withTenantOn(app, A, (tx) => listActiveRoster(tx, A, teamXId));
    expect(roster.filter((r) => r.memberId === keep.memberId)).toHaveLength(1);
    expect(roster.some((r) => r.memberId === remove.memberId)).toBe(false);
  });
});
