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
import { openRenewalPeriod } from "@/lib/admin/memberships";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { isMember, membershipDisplay } from "@/lib/membership";
import { getDeclarationForm, submitDeclaration } from "@/lib/memberships/declaration";
import { composeMail } from "@/lib/mail/templates";
import { addPlayer } from "@/lib/teams/roster";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 年度更新の申告（設計書 §5.12「申告フロー」・D-03）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `申告${random()}`;

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

// 受付は日本時間 2027-04-01〜2027-06-30
const DURING = new Date("2027-05-10T00:00:00Z");
const AFTER = new Date("2027-07-05T00:00:00Z");

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
let strangerId = "";
let teamId = "";
let notTargetTeamId = "";
// 選手（members.id）
let lastYear1 = "";
let lastYear2 = "";
let newcomer = "";

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `dc-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `dc-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `dc-other-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId, strangerId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `dc-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  const base = { kana: null, contactEmail: null, contactPhone: null };
  teamId = (await registerTeam(app, A, repId, { ...base, name: `${tag} チーム`, membershipRenewalTarget: true })).id;
  notTargetTeamId = (await registerTeam(app, A, repId, { ...base, name: `${tag} 寄せ集め`, membershipRenewalTarget: false })).id;

  const add = async (name: string, birthDate: string): Promise<string> => {
    const added = await addPlayer(app, as(repId), A, teamId, { name: `${tag} ${name}`, kana: "", birthDate, sex: "male" });
    return added.memberId;
  };
  lastYear1 = await add("継続A", "1988-01-02");
  lastYear2 = await add("継続B", "1989-03-04");
  newcomer = await add("新顔", "1995-06-07");

  // 昨年度（2026）の会員を 2 人作る（初期チェックの確認用）
  await withTenantOn(owner, A, (tx) =>
    tx.insert(memberships).values([
      { associationId: A, memberId: lastYear1, teamId, year: 2026, status: "approved", source: "renewal" },
      { associationId: A, memberId: lastYear2, teamId, year: 2026, status: "approved", source: "renewal" },
    ]),
  );
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
  await owner.delete(users).where(inArray(users.id, [adminId, repId, strangerId]));
  await closeDb(owner);
  await closeDb(app);
});

const statusOfMember = async (memberId: string, year = 2027): Promise<string | null> => {
  const [row] = await withTenantOn(owner, A, (tx) =>
    tx
      .select({ status: memberships.status, source: memberships.source, approvedAt: memberships.approvedAt })
      .from(memberships)
      .where(and(eq(memberships.associationId, A), eq(memberships.memberId, memberId), eq(memberships.year, year))),
  );
  return row?.status ?? null;
};

describe("申告の画面", () => {
  it("昨年度の会員に初期チェックが入る", async () => {
    const form = await getDeclarationForm(app, as(repId), A, teamId, DURING);
    expect(form.year).toBe(2027);
    expect(form.submittedAt).toBeNull();
    expect(form.players.map((p) => [p.name, p.wasMemberLastYear, p.checked])).toEqual([
      [`${tag} 継続A`, true, true],
      [`${tag} 継続B`, true, true],
      [`${tag} 新顔`, false, false],
    ]);
  });

  it("対象でないチーム・締切後・無効なチームは 409", async () => {
    expect(await statusOf(() => getDeclarationForm(app, as(repId), A, notTargetTeamId, DURING))).toBe(409);
    expect(await statusOf(() => getDeclarationForm(app, as(repId), A, teamId, AFTER))).toBe(409);
  });

  it("代表者でない人は 403。ないチームは 404", async () => {
    expect(await statusOf(() => getDeclarationForm(app, as(strangerId), A, teamId, DURING))).toBe(403);
    expect(await statusOf(() => getDeclarationForm(app, as(repId), A, crypto.randomUUID(), DURING))).toBe(404);
  });
});

describe("申告の送信", () => {
  it("チェックした人が applied になり、外した昨年度の会員は declined になる", async () => {
    const result = await submitDeclaration(app, as(repId), A, teamId, { memberIds: [lastYear1, newcomer] }, DURING);
    expect(result).toEqual({ year: 2027, added: 2, removed: 1, unchanged: 0 });
    expect(await statusOfMember(lastYear1)).toBe("applied");
    expect(await statusOfMember(newcomer)).toBe("applied");
    expect(await statusOfMember(lastYear2)).toBe("declined");
    // applied はまだ会員ではない（§5.12）
    await withTenantOn(app, A, async (tx) => {
      expect(await isMember(tx, A, lastYear1, 2027)).toBe(false);
      expect(await membershipDisplay(tx, A, lastYear1, 2027, DURING)).toBe("pending");
      // 外された人は「更新の受付中」にならない
      expect(await membershipDisplay(tx, A, lastYear2, 2027, DURING)).toBe("not_member");
    });
  });

  it("送ると「申告済み」になり、控えのメールが積まれる", async () => {
    const form = await getDeclarationForm(app, as(repId), A, teamId, DURING);
    expect(form.submittedAt).not.toBeNull();
    const queued = await owner
      .select({ id: mailLogs.id, params: mailLogs.params, toEmail: mailLogs.toEmail })
      .from(mailLogs)
      .where(and(eq(mailLogs.associationId, A), eq(mailLogs.mailType, "membership_applied")));
    expect(queued.length).toBe(1);
    // 本文には氏名だけを載せる（生年月日は載せない）
    // 本文の組み立ては、送信ジョブと同じく協会に固定したトランザクションの中で行う（§11）
    const mail = await withTenantOn(owner, A, (tx) =>
      composeMail("membership_applied", queued[0].params as Record<string, unknown>, {
        associationName: `${tag} 協会`,
        associationSlug: "dc",
        baseUrl: "http://localhost:3000",
      }, tx),
    );
    expect(mail.subject).toContain("2027年度の協会員の申告を受け付けました");
    expect(mail.text).toContain("継続A");
    expect(mail.text).not.toContain("1988");
    expect(mail.text).not.toContain("継続B"); // 外した人は載せない
  });

  it("締切前の送り直しで、変えていない人の状態は変わらない", async () => {
    // 運営が lastYear1 を承認した状態にする
    await withTenantOn(owner, A, (tx) =>
      tx
        .update(memberships)
        .set({ status: "approved", approvedBy: adminId, approvedAt: DURING })
        .where(and(eq(memberships.associationId, A), eq(memberships.memberId, lastYear1), eq(memberships.year, 2027))),
    );
    // 新顔のチェックだけ外して送り直す
    const result = await submitDeclaration(app, as(repId), A, teamId, { memberIds: [lastYear1] }, DURING);
    // 変わるのは外した新顔だけ（承認済みの継続A と、すでに declined の継続B はそのまま）
    expect(result).toEqual({ year: 2027, added: 0, removed: 1, unchanged: 2 });
    // 承認済みのままで、承認が取り消されていない
    expect(await statusOfMember(lastYear1)).toBe("approved");
    expect(await statusOfMember(newcomer)).toBe("declined");
    await withTenantOn(app, A, async (tx) => {
      expect(await isMember(tx, A, lastYear1, 2027)).toBe(true);
    });
  });

  it("一度外した人にチェックを入れ直すと applied に戻る", async () => {
    await submitDeclaration(app, as(repId), A, teamId, { memberIds: [lastYear1, lastYear2] }, DURING);
    expect(await statusOfMember(lastYear2)).toBe("applied");
    expect(await statusOfMember(newcomer)).toBe("declined");
  });

  it("全員のチェックを外して送っても申告済みになる", async () => {
    const result = await submitDeclaration(app, as(repId), A, teamId, { memberIds: [] }, DURING);
    expect(result.removed).toBeGreaterThan(0);
    const form = await getDeclarationForm(app, as(repId), A, teamId, DURING);
    expect(form.submittedAt).not.toBeNull();
    expect(form.players.every((p) => !p.checked)).toBe(true);
  });

  it("締切後は代表者が送れない（409）", async () => {
    expect(await statusOf(() => submitDeclaration(app, as(repId), A, teamId, { memberIds: [lastYear1] }, AFTER))).toBe(409);
  });

  it("選手一覧にいない人は選べない（400）", async () => {
    expect(await statusOf(() => submitDeclaration(app, as(repId), A, teamId, { memberIds: [crypto.randomUUID()] }, DURING))).toBe(400);
  });

  it("代表者でない人は送れない（403）", async () => {
    expect(await statusOf(() => submitDeclaration(app, as(strangerId), A, teamId, { memberIds: [] }, DURING))).toBe(403);
  });
});

describe("承認を省く年度", () => {
  it("送るとそのまま協会員になる", async () => {
    await withTenantOn(owner, A, (tx) =>
      tx
        .update(membershipPeriods)
        .set({ autoApprove: true })
        .where(and(eq(membershipPeriods.associationId, A), eq(membershipPeriods.year, 2027))),
    );
    await submitDeclaration(app, as(repId), A, teamId, { memberIds: [newcomer] }, DURING);
    expect(await statusOfMember(newcomer)).toBe("approved");
    await withTenantOn(app, A, async (tx) => {
      expect(await isMember(tx, A, newcomer, 2027)).toBe(true);
    });
    // 承認した人は残さない（人が承認したわけではない）
    const [row] = await withTenantOn(owner, A, (tx) =>
      tx
        .select({ approvedBy: memberships.approvedBy, approvedAt: memberships.approvedAt })
        .from(memberships)
        .where(and(eq(memberships.associationId, A), eq(memberships.memberId, newcomer), eq(memberships.year, 2027))),
    );
    expect(row.approvedBy).toBeNull();
    expect(row.approvedAt).not.toBeNull();
  });
});
