import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, mailLogs, members, membershipDeclarations, membershipPeriods, memberships, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { approveMemberships, getMembershipYearForAdmin } from "@/lib/admin/membership-approval";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { endOfDayTokyo, startOfDayTokyo } from "@/lib/date";
import { getDeclarationView, submitDeclaration } from "@/lib/memberships/declaration";
import { listMembershipRows } from "@/lib/repo/memberships";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer, getRoster } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 承認と追加の申告（設計書 §5.12 の受け入れ条件・D-04）。年度は 2093（受付 2091・申告 2092・判定 2991 と分ける）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `承認${random()}`;
const Y = 2093;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const OPEN = new Date("2093-05-10T00:00:00Z");
const CLOSED = new Date("2093-08-01T00:00:00Z"); // 締切後・年度内（早良区協会は 4 月開始 → 年度末は 2094-03-31）
const NEXT_YEAR = new Date("2094-04-15T00:00:00Z"); // 年度末を過ぎた

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
let repEmail = "";
let teamA = "";
let teamB = "";
let teamC = ""; // 対象でないチーム
const m: Record<"a1" | "a2" | "b1", string> = { a1: "", a2: "", b1: "" };

const rowsOf = () => withTenantOn(app, S, (tx) => listMembershipRows(tx, S, Object.values(m), [Y]));
const statusIn = (rows: Awaited<ReturnType<typeof rowsOf>>, memberId: string) => rows.get(memberId)?.get(Y)?.status ?? null;
const sourceIn = (rows: Awaited<ReturnType<typeof rowsOf>>, memberId: string) => rows.get(memberId)?.get(Y)?.source ?? null;
const mailsTo = async (type: string) =>
  (await owner.select({ mailType: mailLogs.mailType }).from(mailLogs).where(eq(mailLogs.toEmail, repEmail))).filter((x) => x.mailType === type).length;
const setAutoApprove = (value: boolean) =>
  withTenantOn(owner, S, (tx) => tx.update(membershipPeriods).set({ autoApprove: value }).where(and(eq(membershipPeriods.associationId, S), eq(membershipPeriods.year, Y))));

beforeAll(async () => {
  const [admin] = await owner.insert(users).values({ email: `ma-admin-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  adminId = admin.id;
  repEmail = `ma-rep-${random()}@example.com`;
  const [rep] = await owner.insert(users).values({ email: repEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  repId = rep.id;
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: adminId }));
  const base = { kana: null, contactEmail: null, contactPhone: null };
  teamA = (await registerTeam(app, S, repId, { ...base, name: `${tag} A`, membershipRenewalTarget: true })).id;
  teamB = (await registerTeam(app, S, repId, { ...base, name: `${tag} B`, membershipRenewalTarget: true })).id;
  teamC = (await registerTeam(app, S, repId, { ...base, name: `${tag} C 寄せ集め`, membershipRenewalTarget: false })).id;
  m.a1 = (await addPlayer(app, as(repId), S, teamA, { name: `${tag} a1`, kana: "", birthDate: "1990-01-01", sex: "male" })).memberId;
  m.a2 = (await addPlayer(app, as(repId), S, teamA, { name: `${tag} a2`, kana: "", birthDate: "1991-01-01", sex: "female" })).memberId;
  m.b1 = (await addPlayer(app, as(repId), S, teamB, { name: `${tag} b1`, kana: "", birthDate: "1992-01-01", sex: "male" })).memberId;
  await withTenantOn(owner, S, (tx) =>
    tx.insert(membershipPeriods).values({
      associationId: S,
      year: Y,
      opensAt: startOfDayTokyo({ year: Y, month: 4, day: 1 }),
      closesAt: endOfDayTokyo({ year: Y, month: 6, day: 30 }),
      autoApprove: false,
    }),
  );
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(memberships).where(and(eq(memberships.associationId, S), inArray(memberships.memberId, Object.values(m))));
    await tx.delete(membershipDeclarations).where(and(eq(membershipDeclarations.associationId, S), inArray(membershipDeclarations.teamId, [teamA, teamB, teamC])));
    await tx.delete(membershipPeriods).where(and(eq(membershipPeriods.associationId, S), eq(membershipPeriods.year, Y)));
    await tx.delete(teams).where(and(eq(teams.associationId, S), eq(teams.createdBy, repId)));
    await tx.delete(members).where(and(eq(members.associationId, S), inArray(members.id, Object.values(m))));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, adminId));
  });
  await owner.delete(mailLogs).where(eq(mailLogs.toEmail, repEmail));
  await owner.delete(users).where(inArray(users.id, [adminId, repId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("未申告の一覧と一括承認（§5.12）", () => {
  it("受付のない年度は 404、代表者は 403", async () => {
    expect(await statusOf(() => getMembershipYearForAdmin(app, as(adminId), S, 1999, OPEN))).toBe(404);
    expect(await statusOf(() => getMembershipYearForAdmin(app, as(repId), S, Y, OPEN))).toBe(403);
    expect(await statusOf(() => approveMemberships(app, as(repId), S, Y, { scope: "renewal" }))).toBe(403);
  });

  it("未申告の一覧は対象チームだけ。申告すると消える", async () => {
    let view = await getMembershipYearForAdmin(app, as(adminId), S, Y, OPEN);
    const mine = (ids: { id: string }[]) => ids.map((t) => t.id).filter((id) => [teamA, teamB, teamC].includes(id)).sort();
    expect(mine(view.undeclared)).toEqual([teamA, teamB].sort());
    expect(mine(view.declared)).toEqual([]);

    await submitDeclaration(app, as(repId), S, teamA, { memberIds: [m.a1] }, OPEN);
    await submitDeclaration(app, as(repId), S, teamB, { memberIds: [m.b1] }, OPEN);
    view = await getMembershipYearForAdmin(app, as(adminId), S, Y, OPEN);
    expect(mine(view.undeclared)).toEqual([]);
    expect(mine(view.declared)).toEqual([teamA, teamB].sort());
    expect(view.declared.find((t) => t.id === teamA)?.summary).toMatchObject({ applied: 1, approved: 0, declined: 0 });
    expect(view.pendingRenewals).toBeGreaterThanOrEqual(2);
  });

  it("一括承認で applied → approved になり、チームごとに承認のメールが積まれる。承認済みは変わらない", async () => {
    const before = await mailsTo("membership_approved");
    const result = await approveMemberships(app, as(adminId), S, Y, { scope: "renewal", teamIds: [teamA, teamB] });
    expect(result).toEqual({ approved: 2, teams: 2 });
    const rows = await rowsOf();
    expect(statusIn(rows, m.a1)).toBe("approved");
    expect(statusIn(rows, m.b1)).toBe("approved");
    expect(statusIn(rows, m.a2)).toBeNull();
    expect((await mailsTo("membership_approved")) - before).toBe(2);
    // もう一度押しても何も変わらない
    expect(await approveMemberships(app, as(adminId), S, Y, { scope: "renewal", teamIds: [teamA, teamB] })).toEqual({ approved: 0, teams: 0 });
    expect(await statusOf(() => approveMemberships(app, as(adminId), S, Y, { scope: "x" }))).toBe(400);
  });
});

describe("追加の申告（§5.12「年度の途中の追加の申告」）", () => {
  it("締切後〜年度末は追加の申告。承認を省く年度でも applied（source = additional）。外すことはできない", async () => {
    await setAutoApprove(true);
    const view = await getDeclarationView(app, as(repId), S, teamA, CLOSED);
    expect(view.mode).toBe("additional");
    expect(view.canSubmit).toBe(true);
    expect(view.players.find((p) => p.memberId === m.a1)).toMatchObject({ checked: true, locked: true });
    expect(view.players.find((p) => p.memberId === m.a2)).toMatchObject({ checked: false, locked: false });

    // a1 のチェックを外して a2 だけ送っても、a1 は外れない
    const result = await submitDeclaration(app, as(repId), S, teamA, { memberIds: [m.a2] }, CLOSED);
    expect(result).toMatchObject({ mode: "additional", applied: 1, approved: 0, declined: 0 });
    const rows = await rowsOf();
    expect(statusIn(rows, m.a1)).toBe("approved");
    expect(statusIn(rows, m.a2)).toBe("applied");
    expect(sourceIn(rows, m.a2)).toBe("additional");

    // 運営の画面では「追加の申告」に分けて出る
    const admin = await getMembershipYearForAdmin(app, as(adminId), S, Y, CLOSED);
    const additional = admin.additional.find((a) => a.team.id === teamA);
    expect(additional?.rows.map((r) => r.memberId)).toEqual([m.a2]);
    expect(admin.declared.find((t) => t.id === teamA)?.summary.additionalApplied).toBe(1);
  });

  it("追加の申告を承認すると approved になり、メールが積まれる", async () => {
    const before = await mailsTo("membership_approved");
    const result = await approveMemberships(app, as(adminId), S, Y, { scope: "additional", teamIds: [teamA] });
    expect(result).toEqual({ approved: 1, teams: 1 });
    expect(statusIn(await rowsOf(), m.a2)).toBe("approved");
    expect((await mailsTo("membership_approved")) - before).toBe(1);
    expect((await getMembershipYearForAdmin(app, as(adminId), S, Y, CLOSED)).additional.find((a) => a.team.id === teamA)).toBeUndefined();
  });

  it("年度末を過ぎると代表者は 409。テナント管理者は代理で送れる。対象でないチームは受付中でも 409", async () => {
    expect((await getDeclarationView(app, as(repId), S, teamA, NEXT_YEAR)).mode).toBe("closed");
    expect(await statusOf(() => submitDeclaration(app, as(repId), S, teamA, { memberIds: [m.a1, m.a2] }, NEXT_YEAR))).toBe(409);
    expect((await getDeclarationView(app, as(adminId), S, teamA, NEXT_YEAR)).mode).toBe("renewal");
    expect(await statusOf(() => submitDeclaration(app, as(adminId), S, teamA, { memberIds: [m.a1, m.a2] }, NEXT_YEAR))).toBe("ok");
    expect(await statusOf(() => submitDeclaration(app, as(repId), S, teamC, { memberIds: [] }, OPEN))).toBe(409);
  });

  it("選手一覧の「今年度」の区分は同じ判定を通る（§5.12「表示」・D-05）。代表者以上と本人にだけ", async () => {
    const roster = await getRoster(app, as(repId), S, teamA, CLOSED);
    expect(roster.membershipYear).toBe(Y);
    expect(roster.items.find((i) => i.memberId === m.a1)?.membership).toBe(`協会員（${Y}年度）`);
    expect(roster.items.find((i) => i.memberId === m.a2)?.membership).toBe(`協会員（${Y}年度）`);
    // 受付も取り込みもない年度（Y+2 の日付で見る）は出さない
    const later = await getRoster(app, as(repId), S, teamA, new Date(`${Y + 2}-05-01T00:00:00Z`));
    expect(later.items.every((i) => i.membership === null)).toBe(true);
  });
});
