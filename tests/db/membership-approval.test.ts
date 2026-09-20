import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associationAdmins,
  associations,
  mailLogs,
  members,
  membershipDeclarations,
  membershipPeriods,
  memberships,
  teams,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { approveDeclarations, declareForTeamAsAdmin, getRenewalStatusForAdmin, openRenewalPeriod } from "@/lib/admin/memberships";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { composeMail } from "@/lib/mail/templates";
import { isMember } from "@/lib/membership";
import { getDeclarationForm, submitDeclaration } from "@/lib/memberships/declaration";
import { addPlayer } from "@/lib/teams/roster";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 承認と追加の申告（設計書 §5.12 の受け入れ条件・D-04）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `承認${random()}`;

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

// 受付は日本時間 2027-04-01〜2027-06-30。追加の申告は締切後〜年度末（2028-03-31）まで
const DURING = new Date("2027-05-10T00:00:00Z");
const AFTER = new Date("2027-08-01T00:00:00Z");
const NEXT_YEAR = new Date("2028-05-01T00:00:00Z");

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
let teamId = "";
let lateTeamId = ""; // 未申告のまま締切を過ぎるチーム
let keep = "";
let extra = "";
let lateMember = "";

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `ap-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `ap-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `ap-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  const base = { kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: true };
  teamId = (await registerTeam(app, A, repId, { ...base, name: `${tag} 早い組` })).id;
  lateTeamId = (await registerTeam(app, A, repId, { ...base, name: `${tag} 遅い組` })).id;

  const add = async (team: string, name: string, birthDate: string): Promise<string> => {
    const added = await addPlayer(app, as(repId), A, team, { name: `${tag} ${name}`, kana: "", birthDate, sex: "male" });
    return added.memberId;
  };
  keep = await add(teamId, "継続", "1988-01-02");
  extra = await add(teamId, "途中入部", "1999-09-09");
  lateMember = await add(lateTeamId, "遅れた人", "1990-10-10");

  await openRenewalPeriod(app, as(adminId), A, { year: 2027, opensDate: "2027-04-01", closesDate: "2027-06-30" });
});

afterAll(async () => {
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(memberships).where(eq(memberships.associationId, A));
    await tx.delete(membershipDeclarations).where(eq(membershipDeclarations.associationId, A));
    await tx.delete(membershipPeriods).where(eq(membershipPeriods.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, A));
  await owner.delete(associations).where(inArray(associations.id, [A]));
  await owner.delete(users).where(inArray(users.id, [adminId, repId]));
  await closeDb(owner);
  await closeDb(app);
});

const rowOf = async (memberId: string, year = 2027) => {
  const [row] = await withTenantOn(owner, A, (tx) =>
    tx
      .select({ status: memberships.status, source: memberships.source, approvedBy: memberships.approvedBy })
      .from(memberships)
      .where(and(eq(memberships.associationId, A), eq(memberships.memberId, memberId), eq(memberships.year, year))),
  );
  return row ?? null;
};

describe("未申告の一覧と承認", () => {
  it("対象のチームのうち、申告していないチームだけが未申告に出る", async () => {
    await submitDeclaration(app, as(repId), A, teamId, { memberIds: [keep] }, DURING);
    const status = await getRenewalStatusForAdmin(app, as(adminId), A, 2027, DURING);
    expect(status.undeclared.map((t) => t.teamId)).toEqual([lateTeamId]);
    expect(status.pending.map((t) => t.teamId)).toEqual([teamId]);
    expect(status.pending[0].players.map((p) => p.name)).toEqual([`${tag} 継続`]);
    expect(status.additional).toEqual([]);
    expect(status.approvedCount).toBe(0);
  });

  it("一括承認で approved になり、承認のメールが積まれる", async () => {
    const result = await approveDeclarations(app, as(adminId), A, 2027, { memberIds: [keep] }, DURING);
    expect(result.approved).toBe(1);
    expect(await rowOf(keep)).toMatchObject({ status: "approved", approvedBy: adminId });
    await withTenantOn(app, A, async (tx) => {
      expect(await isMember(tx, A, keep, 2027)).toBe(true);
    });
    const status = await getRenewalStatusForAdmin(app, as(adminId), A, 2027, DURING);
    expect(status.pending).toEqual([]);
    expect(status.approvedCount).toBe(1);

    const queued = await owner
      .select({ params: mailLogs.params })
      .from(mailLogs)
      .where(and(eq(mailLogs.associationId, A), eq(mailLogs.mailType, "membership_approved")));
    expect(queued.length).toBe(1);
    const mail = await withTenantOn(owner, A, (tx) =>
      composeMail("membership_approved", queued[0].params as Record<string, unknown>, {
        associationName: `${tag} 協会`,
        associationSlug: "ap",
        baseUrl: "http://localhost:3000",
      }, tx),
    );
    expect(mail.subject).toContain("2027年度の協会員の登録が承認されました");
    expect(mail.text).toContain(`${tag} 継続`);
    expect(mail.text).not.toContain("1988");
  });

  it("すでに承認した人をもう一度承認しても増えない", async () => {
    const result = await approveDeclarations(app, as(adminId), A, 2027, { memberIds: [keep] }, DURING);
    expect(result.approved).toBe(0);
  });

  it("承認する人を選ばないと 400。代表者は承認できない（403）", async () => {
    expect(await statusOf(() => approveDeclarations(app, as(adminId), A, 2027, { memberIds: [] }, DURING))).toBe(400);
    expect(await statusOf(() => approveDeclarations(app, as(repId), A, 2027, { memberIds: [keep] }, DURING))).toBe(403);
    expect(await statusOf(() => getRenewalStatusForAdmin(app, as(repId), A, 2027, DURING))).toBe(403);
  });
});

describe("追加の申告（締切後〜年度末）", () => {
  it("締切後は代表者が会員を増やせる。承認待ち（source = additional）になる", async () => {
    const form = await getDeclarationForm(app, as(repId), A, teamId, AFTER);
    expect(form.mode).toBe("additional");
    // すでに承認済みの人は外せない
    expect(form.players.find((p) => p.memberId === keep)?.locked).toBe(true);
    expect(form.players.find((p) => p.memberId === extra)?.locked).toBe(false);

    const result = await submitDeclaration(app, as(repId), A, teamId, { memberIds: [keep, extra] }, AFTER);
    expect(result.mode).toBe("additional");
    expect(result).toMatchObject({ added: 1, removed: 0 });
    expect(await rowOf(extra)).toMatchObject({ status: "applied", source: "additional" });
  });

  it("追加の申告では外せない（チェックを外して送っても変わらない）", async () => {
    const result = await submitDeclaration(app, as(repId), A, teamId, { memberIds: [] }, AFTER);
    expect(result).toMatchObject({ added: 0, removed: 0 });
    expect(await rowOf(keep)).toMatchObject({ status: "approved" });
    expect(await rowOf(extra)).toMatchObject({ status: "applied" });
  });

  it("運営の画面では追加の申告が分けて出る", async () => {
    const status = await getRenewalStatusForAdmin(app, as(adminId), A, 2027, AFTER);
    expect(status.pending).toEqual([]);
    expect(status.additional.map((t) => t.players.map((p) => p.name))).toEqual([[`${tag} 途中入部`]]);
    expect(status.state).toBe("closed");
  });

  it("承認を省く年度でも、追加の申告は承認待ちになる", async () => {
    await withTenantOn(owner, A, (tx) =>
      tx
        .update(membershipPeriods)
        .set({ autoApprove: true })
        .where(and(eq(membershipPeriods.associationId, A), eq(membershipPeriods.year, 2027))),
    );
    await submitDeclaration(app, as(repId), A, lateTeamId, { memberIds: [lateMember] }, AFTER);
    expect(await rowOf(lateMember)).toMatchObject({ status: "applied", source: "additional" });
    await withTenantOn(owner, A, (tx) =>
      tx
        .update(membershipPeriods)
        .set({ autoApprove: false })
        .where(and(eq(membershipPeriods.associationId, A), eq(membershipPeriods.year, 2027))),
    );
  });

  it("追加の申告も同じ入口で承認できる", async () => {
    const result = await approveDeclarations(app, as(adminId), A, 2027, { memberIds: [extra, lateMember] }, AFTER);
    expect(result.approved).toBe(2);
    expect(await rowOf(extra)).toMatchObject({ status: "approved", source: "additional" });
  });

  it("年度が変わったら送れない（その年度の受付が始まっていないため 409）", async () => {
    expect(await statusOf(() => getDeclarationForm(app, as(repId), A, teamId, NEXT_YEAR))).toBe(409);
    expect(await statusOf(() => submitDeclaration(app, as(repId), A, teamId, { memberIds: [keep] }, NEXT_YEAR))).toBe(409);
  });
});

describe("運営の代理の申告・修正", () => {
  it("締切後でも代理で申告・修正できる（外すこともできる）", async () => {
    const result = await declareForTeamAsAdmin(app, as(adminId), A, teamId, { memberIds: [keep] }, AFTER);
    // 代理は受付期間中と同じ扱い。外した人は declined になる
    expect(result.mode).toBe("renewal");
    expect(result.removed).toBe(1);
    expect(await rowOf(extra)).toMatchObject({ status: "declined" });
    expect(await rowOf(keep)).toMatchObject({ status: "approved" });
  });

  it("代理なら、対象になっていないチームにも入力できる", async () => {
    await withTenantOn(owner, A, (tx) => tx.update(teams).set({ membershipRenewalTarget: false }).where(eq(teams.id, lateTeamId)));
    // 代表者は 409
    expect(await statusOf(() => submitDeclaration(app, as(repId), A, lateTeamId, { memberIds: [lateMember] }, AFTER))).toBe(409);
    // 運営の代理は通る
    const result = await declareForTeamAsAdmin(app, as(adminId), A, lateTeamId, { memberIds: [lateMember] }, AFTER);
    expect(result.unchanged).toBe(1);
    await withTenantOn(owner, A, (tx) => tx.update(teams).set({ membershipRenewalTarget: true }).where(eq(teams.id, lateTeamId)));
  });

  it("代表者は代理の入口を使えない（403）", async () => {
    expect(await statusOf(() => declareForTeamAsAdmin(app, as(repId), A, teamId, { memberIds: [keep] }, AFTER))).toBe(403);
  });
});
