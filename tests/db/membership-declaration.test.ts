import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, mailLogs, members, membershipDeclarations, membershipPeriods, memberships, teams, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { endOfDayTokyo, startOfDayTokyo } from "@/lib/date";
import { getDeclarationView, submitDeclaration } from "@/lib/memberships/declaration";
import { listMembershipRows } from "@/lib/repo/memberships";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 年度更新の申告（設計書 §5.12「申告フロー」・D-03）
// 年度は他のテストと重ならないよう 2092 を使う（受付のテストは 2091、会員判定のテストは 2991）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

// 「直近の受付」を読む処理が、並列で走るほかのテストの年度を拾わないよう、専用の協会を作って使う
let S = "";
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `申告${random()}`;
const Y = 2092;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const BEFORE = new Date("2092-03-01T00:00:00Z");
const DURING = new Date("2092-05-10T00:00:00Z");
const LATER = new Date("2092-05-11T00:00:00Z");
const AFTER = new Date("2092-07-01T00:00:00Z"); // 締切後・年度内（追加の申告の期間）
const NEXT_YEAR = new Date("2093-04-15T00:00:00Z"); // 年度末（2093-03-31）を過ぎた

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
let strangerId = "";
let teamId = "";
let plainTeamId = "";
const m: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };

async function rowsOf(): Promise<Map<string, Map<number, { status: string }>>> {
  return withTenantOn(app, S, (tx) => listMembershipRows(tx, S, Object.values(m), [Y, Y - 1]));
}
const statusIn = (rows: Map<string, Map<number, { status: string }>>, memberId: string, year = Y) => rows.get(memberId)?.get(year)?.status ?? null;

beforeAll(async () => {
  const [assoc] = await owner.insert(associations).values({ name: `${tag} 協会`, slug: `md-${random()}` }).returning({ id: associations.id });
  S = assoc.id;
  const [admin] = await owner.insert(users).values({ email: `md-admin-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  adminId = admin.id;
  repEmail = `md-rep-${random()}@example.com`;
  const [rep] = await owner.insert(users).values({ email: repEmail, emailVerifiedAt: new Date() }).returning({ id: users.id });
  repId = rep.id;
  const [stranger] = await owner.insert(users).values({ email: `md-str-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  strangerId = stranger.id;
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: adminId }));

  teamId = (await registerTeam(app, S, repId, { name: `${tag} 対象`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: true })).id;
  plainTeamId = (await registerTeam(app, S, repId, { name: `${tag} 寄せ集め`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;
  for (const key of ["a", "b", "c"] as const) {
    const added = await addPlayer(app, as(repId), S, teamId, { name: `${tag} ${key}`, kana: "", birthDate: "1990-01-01", sex: "male" });
    m[key] = added.memberId;
  }
  await withTenantOn(owner, S, async (tx) => {
    await tx.insert(membershipPeriods).values({
      associationId: S,
      year: Y,
      opensAt: startOfDayTokyo({ year: Y, month: 4, day: 1 }),
      closesAt: endOfDayTokyo({ year: Y, month: 6, day: 30 }),
      autoApprove: false,
    });
    // a は昨年度の会員
    await tx.insert(memberships).values({ associationId: S, memberId: m.a, year: Y - 1, status: "approved", source: "renewal" });
  });
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(memberships).where(and(eq(memberships.associationId, S), inArray(memberships.memberId, Object.values(m))));
    await tx.delete(membershipDeclarations).where(and(eq(membershipDeclarations.associationId, S), inArray(membershipDeclarations.teamId, [teamId, plainTeamId])));
    await tx.delete(membershipPeriods).where(and(eq(membershipPeriods.associationId, S), eq(membershipPeriods.year, Y)));
    await tx.delete(teams).where(and(eq(teams.associationId, S), eq(teams.createdBy, repId)));
    await tx.delete(members).where(and(eq(members.associationId, S), inArray(members.id, Object.values(m))));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, adminId));
  });
  await owner.delete(mailLogs).where(eq(mailLogs.toEmail, repEmail));
  await owner.delete(associations).where(eq(associations.id, S));
  await owner.delete(users).where(inArray(users.id, [adminId, repId, strangerId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("申告の画面（§5.12）", () => {
  it("昨年度の会員に初期チェック。代表者以外は 403、対象でないチームは target = false", async () => {
    const view = await getDeclarationView(app, as(repId), S, teamId, DURING);
    expect(view.target).toBe(true);
    expect(view.period?.year).toBe(Y);
    expect(view.mode).toBe("renewal");
    expect(view.declared).toBeNull();
    expect(view.canSubmit).toBe(true);
    expect(view.players.map((p) => [p.memberId, p.lastYearMember, p.checked])).toEqual([
      [m.a, true, true],
      [m.b, false, false],
      [m.c, false, false],
    ]);
    expect(await statusOf(() => getDeclarationView(app, as(strangerId), S, teamId, DURING))).toBe(403);
    expect((await getDeclarationView(app, as(repId), S, plainTeamId, DURING)).target).toBe(false);
    expect((await getDeclarationView(app, as(repId), S, plainTeamId, DURING)).canSubmit).toBe(false);
    // 締切後〜年度末は追加の申告（増やすだけ）。年度末を過ぎると代表者は送れない（管理者は送れる）
    expect((await getDeclarationView(app, as(repId), S, teamId, AFTER)).mode).toBe("additional");
    expect((await getDeclarationView(app, as(repId), S, teamId, NEXT_YEAR)).canSubmit).toBe(false);
    expect((await getDeclarationView(app, as(adminId), S, teamId, NEXT_YEAR)).canSubmit).toBe(true);
  });
});

describe("申告の送信（§5.12 の受け入れ条件）", () => {
  it("受付前は 409、対象でないチームは 409、選手一覧にいない人は 400、形が違えば 400", async () => {
    expect(await statusOf(() => submitDeclaration(app, as(repId), S, teamId, { memberIds: [m.a] }, BEFORE))).toBe(409);
    expect(await statusOf(() => submitDeclaration(app, as(repId), S, plainTeamId, { memberIds: [] }, DURING))).toBe(409);
    expect(await statusOf(() => submitDeclaration(app, as(repId), S, teamId, { memberIds: ["00000000-0000-4000-8000-000000000000"] }, DURING))).toBe(400);
    expect(await statusOf(() => submitDeclaration(app, as(repId), S, teamId, { memberIds: "a" }, DURING))).toBe(400);
    expect(await statusOf(() => submitDeclaration(app, as(strangerId), S, teamId, { memberIds: [] }, DURING))).toBe(403);
  });

  it("送ると当年度の行が applied で作られ、申告済みになり、控えのメールが積まれる", async () => {
    const result = await submitDeclaration(app, as(repId), S, teamId, { memberIds: [m.a, m.b] }, DURING);
    expect(result).toMatchObject({ year: Y, checked: 2, applied: 2, approved: 0, declined: 0, unchanged: 1 });
    const rows = await rowsOf();
    expect(statusIn(rows, m.a)).toBe("applied");
    expect(statusIn(rows, m.b)).toBe("applied");
    expect(statusIn(rows, m.c)).toBeNull();
    const view = await getDeclarationView(app, as(repId), S, teamId, DURING);
    expect(view.declared).not.toBeNull();
    expect(view.players.map((p) => p.checked)).toEqual([true, true, false]);
    const mails = await owner.select({ mailType: mailLogs.mailType }).from(mailLogs).where(eq(mailLogs.toEmail, repEmail));
    expect(mails.map((x) => x.mailType)).toContain("membership_applied");
  });

  it("締切前の修正: 直した人だけ変わる。外した人は declined、変えていない人はそのまま", async () => {
    const before = (await getDeclarationView(app, as(repId), S, teamId, DURING)).declared?.updatedAt;
    const result = await submitDeclaration(app, as(repId), S, teamId, { memberIds: [m.b] }, LATER);
    expect(result).toMatchObject({ checked: 1, applied: 0, declined: 1, unchanged: 2 });
    const rows = await rowsOf();
    expect(statusIn(rows, m.a)).toBe("declined");
    expect(statusIn(rows, m.b)).toBe("applied");
    expect(statusIn(rows, m.c)).toBeNull();
    const after = (await getDeclarationView(app, as(repId), S, teamId, LATER)).declared?.updatedAt;
    expect(after?.getTime()).toBeGreaterThan(before?.getTime() ?? 0);
  });

  it("全員のチェックを外して送っても申告済みのまま。昨年度の会員でない人は行を作らない", async () => {
    const result = await submitDeclaration(app, as(repId), S, teamId, { memberIds: [] }, LATER);
    expect(result).toMatchObject({ checked: 0, declined: 1 });
    const rows = await rowsOf();
    expect(statusIn(rows, m.a)).toBe("declined");
    expect(statusIn(rows, m.b)).toBe("declined");
    expect(statusIn(rows, m.c)).toBeNull();
    expect((await getDeclarationView(app, as(repId), S, teamId, LATER)).declared).not.toBeNull();
  });

  it("承認を省く年度は、チェックを入れた人がそのまま approved になる", async () => {
    await withTenantOn(owner, S, (tx) => tx.update(membershipPeriods).set({ autoApprove: true }).where(and(eq(membershipPeriods.associationId, S), eq(membershipPeriods.year, Y))));
    const result = await submitDeclaration(app, as(repId), S, teamId, { memberIds: [m.a, m.c] }, LATER);
    expect(result).toMatchObject({ checked: 2, applied: 0, approved: 2, declined: 0 });
    const rows = await rowsOf();
    expect(statusIn(rows, m.a)).toBe("approved");
    expect(statusIn(rows, m.c)).toBe("approved");
    expect(statusIn(rows, m.b)).toBe("declined");
    // 昨年度の行は変わらない
    expect(statusIn(rows, m.a, Y - 1)).toBe("approved");
  });

  it("年度末を過ぎると代表者 409、テナント管理者は代理で送れる", async () => {
    expect(await statusOf(() => submitDeclaration(app, as(repId), S, teamId, { memberIds: [m.a] }, NEXT_YEAR))).toBe(409);
    const result = await submitDeclaration(app, as(adminId), S, teamId, { memberIds: [m.a, m.b, m.c] }, NEXT_YEAR);
    expect(result).toMatchObject({ checked: 3, approved: 1, unchanged: 2 });
    expect(statusIn(await rowsOf(), m.b)).toBe("approved");
  });
});
