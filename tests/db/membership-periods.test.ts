import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, membershipDeclarations, membershipPeriods, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { editMembershipPeriod, listMembershipPeriodsForAdmin, openMembershipPeriod, periodState } from "@/lib/admin/membership-periods";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { endOfDayTokyo, startOfDayTokyo } from "@/lib/date";
import { getTeamRenewalNotice, listRenewalNotices, renewalNoticeText, renewalTodos } from "@/lib/memberships/renewal-notice";
import { addTeamAdmin, createTeam, findTeam } from "@/lib/repo/teams";
import { TeamError } from "@/lib/teams/errors";
import { editTeam, registerTeam } from "@/lib/teams/teams";

// 年度更新の受付開始と対象チーム（設計書 §5.12「受付開始」「年度更新の対象チーム」・D-02）
// 年度は他のテストと重ならないよう、ありえない年（2980 年代）を使う
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `受付${random()}`;
const Y = 2091;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const input = (over: Record<string, unknown> = {}) => ({ year: Y, opensDate: "2091-04-01", closesDate: "2091-06-30", autoApprove: false, ...over });
const DURING = new Date("2091-05-10T00:00:00Z");
const BEFORE = new Date("2091-03-01T00:00:00Z");
const AFTER = new Date("2091-07-01T00:00:00Z");

async function statusOf(run: () => Promise<unknown>): Promise<"ok" | number> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

let adminId = "";
let repId = "";
let otherAssociationId = "";
let otherAdminId = "";
let targetTeamId = "";
let plainTeamId = "";
let individualTeamId = "";

beforeAll(async () => {
  const [admin] = await owner.insert(users).values({ email: `mp-admin-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  adminId = admin.id;
  const [rep] = await owner.insert(users).values({ email: `mp-rep-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  repId = rep.id;
  const [other] = await owner.insert(associations).values({ name: `${tag} 別協会`, slug: `mp-${random()}` }).returning({ id: associations.id });
  otherAssociationId = other.id;
  const [otherAdmin] = await owner.insert(users).values({ email: `mp-other-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  otherAdminId = otherAdmin.id;
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: adminId }));
  await withTenantOn(owner, otherAssociationId, (tx) => tx.insert(associationAdmins).values({ associationId: otherAssociationId, userId: otherAdminId }));

  // 代表者の 3 つ: 協会員の登録をするチーム・しないチーム・個人登録
  targetTeamId = (await registerTeam(app, S, repId, { name: `${tag} 対象`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: true })).id;
  plainTeamId = (await registerTeam(app, S, repId, { name: `${tag} 寄せ集め`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;
  individualTeamId = await withTenantOn(owner, S, async (tx) => {
    const team = await createTeam(tx, S, { name: `${tag} 個人`, kind: "individual", membershipRenewalTarget: false, createdBy: repId });
    await addTeamAdmin(tx, S, team.id, repId, null);
    return team.id;
  });
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(membershipDeclarations).where(and(eq(membershipDeclarations.associationId, S), eq(membershipDeclarations.year, Y)));
    // Y+1（2092）は申告のテスト（membership-declaration.test.ts）が使うので消さない
    await tx.delete(membershipPeriods).where(and(eq(membershipPeriods.associationId, S), eq(membershipPeriods.year, Y)));
    await tx.delete(teams).where(and(eq(teams.associationId, S), eq(teams.createdBy, repId)));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, adminId));
  });
  await withTenantOn(owner, otherAssociationId, (tx) => tx.delete(associationAdmins).where(eq(associationAdmins.associationId, otherAssociationId)));
  await owner.delete(associations).where(eq(associations.id, otherAssociationId));
  await owner.delete(users).where(inArray(users.id, [adminId, repId, otherAdminId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("受付の開始（テナント管理者だけ・§3.2 manageMemberships）", () => {
  it("代表者と別の協会の管理者は 403", async () => {
    expect(await statusOf(() => openMembershipPeriod(app, as(repId), S, input()))).toBe(403);
    expect(await statusOf(() => openMembershipPeriod(app, as(otherAdminId), S, input()))).toBe(403);
  });

  it("入力の誤りは 400（年度・日付・締切が開始より前）", async () => {
    await expect(openMembershipPeriod(app, as(adminId), S, input({ year: "abc" }))).rejects.toMatchObject({ status: 400, extra: { field: "year" } });
    await expect(openMembershipPeriod(app, as(adminId), S, input({ opensDate: "" }))).rejects.toMatchObject({ status: 400, extra: { field: "opensDate" } });
    await expect(openMembershipPeriod(app, as(adminId), S, input({ closesDate: "2091-03-31" }))).rejects.toMatchObject({
      status: 400,
      extra: { field: "closesDate" },
    });
  });

  it("管理者は開始できる。開始は 0:00・締切は 23:59:59（日本時間）。同じ年度は 409", async () => {
    const period = await openMembershipPeriod(app, as(adminId), S, input());
    expect(period.year).toBe(Y);
    expect(period.opensAt).toEqual(startOfDayTokyo({ year: Y, month: 4, day: 1 }));
    expect(period.closesAt).toEqual(endOfDayTokyo({ year: Y, month: 6, day: 30 }));
    expect(period.autoApprove).toBe(false);
    expect(await statusOf(() => openMembershipPeriod(app, as(adminId), S, input()))).toBe(409);
  });

  it("一覧に状態と対象チーム数・申告済み数が出る", async () => {
    const rows = await listMembershipPeriodsForAdmin(app, as(adminId), S, DURING);
    const row = rows.find((r) => r.year === Y);
    expect(row?.state).toBe("open");
    // 対象は「登録をするチーム」と個人登録（寄せ集めチームは数えない）
    expect(row?.targetTeams).toBeGreaterThanOrEqual(2);
    expect(row?.declaredTeams).toBe(0);
    expect(periodState({ opensAt: row!.opensAt, closesAt: row!.closesAt }, BEFORE)).toBe("before");
    expect(periodState({ opensAt: row!.opensAt, closesAt: row!.closesAt }, AFTER)).toBe("closed");
  });

  it("期間と承認の設定は直せる。年度は変えられない（409）。代表者は 403", async () => {
    const [row] = (await listMembershipPeriodsForAdmin(app, as(adminId), S)).filter((r) => r.year === Y);
    const edited = await editMembershipPeriod(app, as(adminId), S, row.id, input({ closesDate: "2091-07-15", autoApprove: true }));
    expect(edited.closesAt).toEqual(endOfDayTokyo({ year: Y, month: 7, day: 15 }));
    expect(edited.autoApprove).toBe(true);
    expect(await statusOf(() => editMembershipPeriod(app, as(adminId), S, row.id, input({ year: Y + 1 })))).toBe(409);
    expect(await statusOf(() => editMembershipPeriod(app, as(repId), S, row.id, input()))).toBe(403);
    expect(await statusOf(() => editMembershipPeriod(app, as(adminId), S, "00000000-0000-4000-8000-000000000000", input()))).toBe(404);
    // 戻す
    await editMembershipPeriod(app, as(adminId), S, row.id, input());
  });
});

describe("対象チームへの案内（§5.12「年度更新の対象チーム」・§5.17）", () => {
  it("受付中は、登録をするチームと個人登録にだけ案内が出る。寄せ集めチームには出ない", async () => {
    const notices = await listRenewalNotices(app, as(repId), S, DURING);
    expect(notices.map((n) => n.teamId).sort()).toEqual([targetTeamId, individualTeamId].sort());
    expect(notices.every((n) => n.year === Y && !n.declared)).toBe(true);
    const todos = renewalTodos("sawara", notices, DURING);
    expect(todos.find((t) => t.href === `/sawara/teams/${targetTeamId}/membership`)?.text).toContain(`${tag} 対象: ${Y}年度も登録する人を選んでください`);
    expect(todos.find((t) => t.href === `/sawara/teams/${individualTeamId}/membership`)?.text).toMatch(new RegExp(`^${Y}年度も登録する人を選んでください`));
    expect(renewalNoticeText(notices[0], DURING)).toMatch(/まで　あと\d+日）$/);
  });

  it("受付前・締切後・未ログインは出ない", async () => {
    expect(await listRenewalNotices(app, as(repId), S, BEFORE)).toEqual([]);
    expect(await listRenewalNotices(app, as(repId), S, AFTER)).toEqual([]);
    expect(await listRenewalNotices(app, ANONYMOUS, S, DURING)).toEqual([]);
  });

  it("チームのページ用: 対象なら受付の情報つき、対象でなければ null。申告済みなら declared", async () => {
    const target = await withTenantOn(app, S, (tx) => findTeam(tx, S, targetTeamId));
    const plain = await withTenantOn(app, S, (tx) => findTeam(tx, S, plainTeamId));
    expect((await getTeamRenewalNotice(app, S, target!, DURING))?.period.year).toBe(Y);
    expect(await getTeamRenewalNotice(app, S, plain!, DURING)).toBeNull();

    await withTenantOn(owner, S, (tx) => tx.insert(membershipDeclarations).values({ associationId: S, teamId: targetTeamId, year: Y, submittedBy: repId }));
    expect((await getTeamRenewalNotice(app, S, target!, DURING))?.declared).toBe(true);
    const notices = await listRenewalNotices(app, as(repId), S, DURING);
    expect(notices.find((n) => n.teamId === targetTeamId)?.declared).toBe(true);
    expect(renewalNoticeText({ year: Y, closesAt: endOfDayTokyo({ year: Y, month: 6, day: 30 }), declared: true }, DURING)).toContain("申告を送りました");
    expect((await listMembershipPeriodsForAdmin(app, as(adminId), S, DURING)).find((r) => r.year === Y)?.declaredTeams).toBe(1);
  });

  it("「協会員の登録をするチーム」は代表者もテナント管理者も変えられる（§5.11）。変えると案内が出る／消える", async () => {
    const base = { name: `${tag} 寄せ集め`, kana: "", contactEmail: "", contactPhone: "" };
    const byRep = await editTeam(app, as(repId), S, plainTeamId, { ...base, membershipRenewalTarget: true });
    expect(byRep.membershipRenewalTarget).toBe(true);
    expect((await listRenewalNotices(app, as(repId), S, DURING)).map((n) => n.teamId)).toContain(plainTeamId);
    const byAdmin = await editTeam(app, as(adminId), S, plainTeamId, { ...base, membershipRenewalTarget: false });
    expect(byAdmin.membershipRenewalTarget).toBe(false);
    expect((await listRenewalNotices(app, as(repId), S, DURING)).map((n) => n.teamId)).not.toContain(plainTeamId);
  });
});
