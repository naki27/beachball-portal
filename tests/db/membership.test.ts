import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associations, members, membershipPeriods, memberships, teams, users } from "@/db/schema";
import type { MembershipSource, MembershipStatus } from "@/db/schema/memberships";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS } from "@/lib/authz";
import { isMember, membershipDisplay, membershipDisplays } from "@/lib/membership";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 会員判定（設計書 §5.12・付録 F・D-01）の DB を読む版。表そのものの試験は tests/unit/membership.test.ts
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `会員${random()}`;

// 2027 年度の受付は日本時間 2027-04-01 0:00〜2027-06-30 23:59:59.999
const OPENS = new Date("2027-03-31T15:00:00Z");
const CLOSES = new Date("2027-06-30T14:59:59.999Z");
const DURING = new Date("2027-05-10T00:00:00Z");
const AFTER = new Date("2027-07-01T00:00:00Z");

let A = "";
let repId = "";
// 人物（members.id）
let keep = ""; // 昨年度も今年度も協会員
let renew = ""; // 昨年度は協会員・今年度はまだ申告なし
let applied = ""; // 今年度は申告済み（確認待ち）
let declined = ""; // 今年度は「更新しない」
let fresh = ""; // 昨年度も今年度もデータなし

beforeAll(async () => {
  const [user] = await owner
    .insert(users)
    .values({ email: `mb-rep-${random()}@example.com`, emailVerifiedAt: new Date() })
    .returning({ id: users.id });
  repId = user.id;
  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `mb-${random()}` })
    .returning({ id: associations.id });
  A = association.id;

  const team = await registerTeam(app, A, repId, {
    name: `${tag} チーム`,
    kana: null,
    contactEmail: null,
    contactPhone: null,
    membershipRenewalTarget: true,
  });

  const as = { ...ANONYMOUS, userId: repId, sessionState: "active" as const };
  const add = async (name: string): Promise<string> => {
    const added = await addPlayer(app, as, A, team.id, { name, kana: "", birthDate: "1990-05-05", sex: "male" });
    return added.memberId;
  };
  keep = await add(`${tag} 継続`);
  renew = await add(`${tag} 未申告`);
  applied = await add(`${tag} 申告済`);
  declined = await add(`${tag} 更新しない`);
  fresh = await add(`${tag} 新顔`);
});

async function setStatus(memberId: string, year: number, status: MembershipStatus, source: MembershipSource = "renewal"): Promise<void> {
  await withTenantOn(owner, A, (tx) => tx.insert(memberships).values({ associationId: A, memberId, year, status, source }));
}

async function openPeriod(year: number): Promise<void> {
  await withTenantOn(owner, A, (tx) =>
    tx.insert(membershipPeriods).values({ associationId: A, year, opensAt: OPENS, closesAt: CLOSES }),
  );
}

async function clearPeriods(): Promise<void> {
  await withTenantOn(owner, A, (tx) => tx.delete(membershipPeriods).where(eq(membershipPeriods.associationId, A)));
}

afterAll(async () => {
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(memberships).where(eq(memberships.associationId, A));
    await tx.delete(membershipPeriods).where(eq(membershipPeriods.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
  });
  await owner.delete(associations).where(inArray(associations.id, [A]));
  await owner.delete(users).where(inArray(users.id, [repId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("isMember（年度を渡さないと呼べない）", () => {
  it("前年度の approved は、新年度では会員ではない", async () => {
    await setStatus(keep, 2026, "approved");
    await withTenantOn(app, A, async (tx) => {
      expect(await isMember(tx, A, keep, 2026)).toBe(true);
      expect(await isMember(tx, A, keep, 2027)).toBe(false);
    });
  });

  it("applied はまだ会員ではない", async () => {
    await setStatus(applied, 2027, "applied");
    await withTenantOn(app, A, async (tx) => {
      expect(await isMember(tx, A, applied, 2027)).toBe(false);
    });
  });

  it("declined・行なしは会員ではない", async () => {
    await setStatus(declined, 2027, "declined");
    await withTenantOn(app, A, async (tx) => {
      expect(await isMember(tx, A, declined, 2027)).toBe(false);
      expect(await isMember(tx, A, fresh, 2027)).toBe(false);
    });
  });
});

describe("membershipDisplay", () => {
  it("受付も取り込みもない年度は no_data", async () => {
    await withTenantOn(app, A, async (tx) => {
      expect(await membershipDisplay(tx, A, keep, 2027, DURING)).toBe("no_data");
      // 昨年度（2026）は 2026 の受付も取り込みもないので、approved でも no_data
      expect(await membershipDisplay(tx, A, keep, 2026, DURING)).toBe("no_data");
    });
  });

  it("取り込みのデータがあれば、受付がなくても区分を出す", async () => {
    await setStatus(renew, 2026, "approved", "import");
    await withTenantOn(app, A, async (tx) => {
      expect(await membershipDisplay(tx, A, keep, 2026, DURING)).toBe("member");
      expect(await membershipDisplay(tx, A, fresh, 2026, DURING)).toBe("not_member");
    });
  });

  it("受付期間中は、昨年度の会員で今年度の申告がまだなら renewal_pending", async () => {
    await openPeriod(2027);
    await withTenantOn(app, A, async (tx) => {
      expect(await membershipDisplay(tx, A, renew, 2027, DURING)).toBe("renewal_pending");
      expect(await membershipDisplay(tx, A, applied, 2027, DURING)).toBe("pending");
      expect(await membershipDisplay(tx, A, declined, 2027, DURING)).toBe("not_member");
      // 昨年度も会員でない人は「更新の受付中」にしない
      expect(await membershipDisplay(tx, A, fresh, 2027, DURING)).toBe("not_member");
    });
  });

  it("締切を過ぎたら not_member", async () => {
    await withTenantOn(app, A, async (tx) => {
      expect(await membershipDisplay(tx, A, renew, 2027, AFTER)).toBe("not_member");
      expect(await membershipDisplay(tx, A, renew, 2027, CLOSES)).toBe("renewal_pending");
    });
  });

  it("今年度も承認されれば member", async () => {
    await setStatus(keep, 2027, "approved");
    await withTenantOn(app, A, async (tx) => {
      expect(await membershipDisplay(tx, A, keep, 2027, DURING)).toBe("member");
      expect(await membershipDisplay(tx, A, keep, 2027, AFTER)).toBe("member");
    });
  });

  it("まとめて引いても 1 人ずつと同じ区分になる", async () => {
    const ids = [keep, renew, applied, declined, fresh];
    await withTenantOn(app, A, async (tx) => {
      const map = await membershipDisplays(tx, A, ids, 2027, DURING);
      expect([...map.values()]).toEqual(["member", "renewal_pending", "pending", "not_member", "not_member"]);
      for (const id of ids) expect(map.get(id)).toBe(await membershipDisplay(tx, A, id, 2027, DURING));
    });
  });

  it("受付を消すと、まとめて引いたときも no_data になる", async () => {
    await clearPeriods();
    await withTenantOn(app, A, async (tx) => {
      const map = await membershipDisplays(tx, A, [keep, fresh], 2027, DURING);
      expect([...map.values()]).toEqual(["no_data", "no_data"]);
    });
  });
});
