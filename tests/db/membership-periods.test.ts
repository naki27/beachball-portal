import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, membershipDeclarations, membershipPeriods, teams, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { editRenewalPeriod, getMembershipsForAdmin, openRenewalPeriod } from "@/lib/admin/memberships";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { loadRenewalNotices, renewalNoticeText } from "@/lib/memberships/renewal-notice";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 年度更新の受付開始と対象チーム（設計書 §5.12「受付開始」「年度更新の対象チーム」・D-02）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `受付${random()}`;

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

// 受付は日本時間 2027-04-01〜2027-06-30
const BEFORE = new Date("2027-03-20T00:00:00Z");
const DURING = new Date("2027-06-25T00:00:00Z"); // 日本時間 6/25 9:00 → 締切まであと 5 日
const AFTER = new Date("2027-07-05T00:00:00Z");

const input = (over: Record<string, unknown> = {}) => ({ year: "2027", opensDate: "2027-04-01", closesDate: "2027-06-30", ...over });

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
let adminId = "";
let repId = "";
let targetTeamId = "";
let otherTeamId = "";

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `pd-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `pd-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `pd-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  const base = { kana: null, contactEmail: null, contactPhone: null };
  targetTeamId = (await registerTeam(app, A, repId, { ...base, name: `${tag} 登録する`, membershipRenewalTarget: true })).id;
  otherTeamId = (await registerTeam(app, A, repId, { ...base, name: `${tag} 登録しない`, membershipRenewalTarget: false })).id;
});

afterAll(async () => {
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(membershipDeclarations).where(eq(membershipDeclarations.associationId, A));
    await tx.delete(membershipPeriods).where(eq(membershipPeriods.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(associations).where(inArray(associations.id, [A]));
  await owner.delete(users).where(inArray(users.id, [adminId, repId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("受付開始", () => {
  it("年度・受付期間・承認を省くかを設定して始められる。締切は日本時間の 23:59:59", async () => {
    await openRenewalPeriod(app, as(adminId), A, input());
    const view = await getMembershipsForAdmin(app, as(adminId), A, DURING);
    const period = view.periods.find((row) => row.year === 2027);
    expect(period).toBeTruthy();
    expect(period?.state).toBe("open");
    expect(period?.autoApprove).toBe(false);
    // 開始は 4/1 0:00（JST）= 3/31 15:00 UTC、締切は 6/30 23:59:59.999（JST）= 6/30 14:59:59.999 UTC
    expect(period?.opensAt.toISOString()).toBe("2027-03-31T15:00:00.000Z");
    expect(period?.closesAt.toISOString()).toBe("2027-06-30T14:59:59.999Z");
    // 対象のチームは 1 組だけ（「登録しない」チームは数えない）
    expect(period?.targetTeams).toBe(1);
    expect(period?.declaredTeams).toBe(0);
  });

  it("開始前・締切後は状態が変わる", async () => {
    expect((await getMembershipsForAdmin(app, as(adminId), A, BEFORE)).periods[0].state).toBe("not_started");
    expect((await getMembershipsForAdmin(app, as(adminId), A, AFTER)).periods[0].state).toBe("closed");
  });

  it("同じ年度を 2 回始められない（409）", async () => {
    expect(await statusOf(() => openRenewalPeriod(app, as(adminId), A, input()))).toBe(409);
  });

  it("締切を延ばせる・承認を省く設定に変えられる", async () => {
    await editRenewalPeriod(app, as(adminId), A, 2027, { opensDate: "2027-04-01", closesDate: "2027-07-31", autoApprove: "true" });
    const period = (await getMembershipsForAdmin(app, as(adminId), A, AFTER)).periods[0];
    expect(period.state).toBe("open");
    expect(period.autoApprove).toBe(true);
    // 元に戻す（あとの試験のため）
    await editRenewalPeriod(app, as(adminId), A, 2027, { opensDate: "2027-04-01", closesDate: "2027-06-30" });
  });

  it("入力の誤りは 400。締切が開始より前も 400", async () => {
    expect(await statusOf(() => openRenewalPeriod(app, as(adminId), A, input({ year: "202" })))).toBe(400);
    expect(await statusOf(() => openRenewalPeriod(app, as(adminId), A, input({ year: "2028", opensDate: "" })))).toBe(400);
    expect(await statusOf(() => openRenewalPeriod(app, as(adminId), A, input({ year: "2028", closesDate: "2027-03-31" })))).toBe(400);
  });

  it("ない年度は 404", async () => {
    expect(await statusOf(() => editRenewalPeriod(app, as(adminId), A, 2099, { opensDate: "2099-04-01", closesDate: "2099-06-30" }))).toBe(404);
  });

  it("代表者は受付を始められない・見られない（403）", async () => {
    expect(await statusOf(() => openRenewalPeriod(app, as(repId), A, input({ year: "2028" })))).toBe(403);
    expect(await statusOf(() => getMembershipsForAdmin(app, as(repId), A))).toBe(403);
    expect(await statusOf(() => editRenewalPeriod(app, as(repId), A, 2027, { opensDate: "2027-04-01", closesDate: "2027-06-30" }))).toBe(403);
  });
});

describe("対象チームの代表者への案内", () => {
  it("受付期間中、対象のチームにだけ案内が出る", async () => {
    const notices = await loadRenewalNotices(as(repId), A, DURING);
    expect(notices.map((n) => n.teamId)).toEqual([targetTeamId]);
    expect(notices[0].declared).toBe(false);
    expect(renewalNoticeText(notices[0], DURING)).toBe("2027年度も登録する人を選んでください（6月30日（水）まで　あと5日）");
  });

  it("受付の開始前・締切後は出ない", async () => {
    expect(await loadRenewalNotices(as(repId), A, BEFORE)).toEqual([]);
    expect(await loadRenewalNotices(as(repId), A, AFTER)).toEqual([]);
  });

  it("代表者でない人には出ない", async () => {
    expect(await loadRenewalNotices(as(adminId), A, DURING)).toEqual([]);
  });

  it("対象に変えれば出る、外せば出なくなる", async () => {
    await withTenantOn(owner, A, (tx) => tx.update(teams).set({ membershipRenewalTarget: true }).where(eq(teams.id, otherTeamId)));
    expect((await loadRenewalNotices(as(repId), A, DURING)).map((n) => n.teamId).sort()).toEqual([targetTeamId, otherTeamId].sort());
    await withTenantOn(owner, A, (tx) => tx.update(teams).set({ membershipRenewalTarget: false }).where(eq(teams.id, otherTeamId)));
    expect((await loadRenewalNotices(as(repId), A, DURING)).map((n) => n.teamId)).toEqual([targetTeamId]);
  });

  it("無効にしたチームには出ない", async () => {
    await withTenantOn(owner, A, (tx) => tx.update(teams).set({ status: "inactive" }).where(eq(teams.id, targetTeamId)));
    expect(await loadRenewalNotices(as(repId), A, DURING)).toEqual([]);
    await withTenantOn(owner, A, (tx) => tx.update(teams).set({ status: "active" }).where(eq(teams.id, targetTeamId)));
  });

  it("申告を送ったチームは「送りました」になり、管理画面の数にも出る", async () => {
    await withTenantOn(owner, A, (tx) =>
      tx.insert(membershipDeclarations).values({ associationId: A, teamId: targetTeamId, year: 2027, submittedBy: repId }),
    );
    const notices = await loadRenewalNotices(as(repId), A, DURING);
    expect(notices[0].declared).toBe(true);
    expect(renewalNoticeText(notices[0], DURING)).toBe("2027年度の協会員の申告を送りました");
    const period = (await getMembershipsForAdmin(app, as(adminId), A, DURING)).periods[0];
    expect(period.declaredTeams).toBe(1);
  });
});
