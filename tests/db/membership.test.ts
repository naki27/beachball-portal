import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { members, membershipPeriods, memberships } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { isMember, membershipDisplay, membershipDisplays } from "@/lib/membership";
import { normalizeName } from "@/lib/normalize";

// 会員判定（設計書 §5.12・付録 F・D-01）。DB の行から isMember / membershipDisplay を確かめる
// 年度は他のテストと重ならないよう、ありえない年（2990 年代）を使う
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `会員${random()}`;
const Y = 2991; // 今年度（受付あり）
const NO_DATA_YEAR = 2995; // 受付も取り込みもない年度

const CLOSES_AT = new Date("2991-06-30T14:59:59.999Z"); // 日本時間 6/30 23:59:59
const DURING = new Date("2991-05-10T00:00:00Z");
const AFTER = new Date("2991-07-01T00:00:00Z");

const ids: Record<string, string> = {};

async function person(name: string): Promise<string> {
  const [row] = await withTenantOn(owner, S, (tx) =>
    tx
      .insert(members)
      .values({ associationId: S, name: `${tag} ${name}`, birthDate: "1990-01-01", sex: "male", nameNormalized: normalizeName(`${tag} ${name}`) })
      .returning({ id: members.id }),
  );
  return row.id;
}

beforeAll(async () => {
  ids.approved = await person("承認済み");
  ids.applied = await person("申告済み");
  ids.declined = await person("更新しない");
  ids.lastYear = await person("昨年度だけ");
  ids.none = await person("行なし");
  await withTenantOn(owner, S, async (tx) => {
    await tx.insert(membershipPeriods).values({ associationId: S, year: Y, opensAt: new Date("2991-04-01T00:00:00Z"), closesAt: CLOSES_AT });
    await tx.insert(memberships).values([
      { associationId: S, memberId: ids.approved, year: Y, status: "approved" },
      { associationId: S, memberId: ids.approved, year: Y - 1, status: "approved" },
      { associationId: S, memberId: ids.applied, year: Y, status: "applied" },
      { associationId: S, memberId: ids.declined, year: Y, status: "declined" },
      { associationId: S, memberId: ids.declined, year: Y - 1, status: "approved" },
      { associationId: S, memberId: ids.lastYear, year: Y - 1, status: "approved" },
      // 受付のない年度に approved があっても、表示は no_data（判定はする）
      { associationId: S, memberId: ids.approved, year: NO_DATA_YEAR, status: "approved" },
    ]);
  });
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(memberships).where(and(eq(memberships.associationId, S), inArray(memberships.memberId, Object.values(ids))));
    await tx.delete(membershipPeriods).where(and(eq(membershipPeriods.associationId, S), eq(membershipPeriods.year, Y)));
    await tx.delete(members).where(and(eq(members.associationId, S), inArray(members.id, Object.values(ids))));
  });
  await closeDb(owner);
  await closeDb(app);
});

describe("isMember（年度を渡す・approved だけ）", () => {
  it("今年度 approved は会員。applied・declined・行なしは会員でない", async () => {
    await withTenantOn(app, S, async (tx) => {
      expect(await isMember(tx, S, ids.approved, Y)).toBe(true);
      expect(await isMember(tx, S, ids.applied, Y)).toBe(false);
      expect(await isMember(tx, S, ids.declined, Y)).toBe(false);
      expect(await isMember(tx, S, ids.none, Y)).toBe(false);
    });
  });

  it("前年度 approved の人は新年度では会員でない（年度をまたぐと切り替わる）", async () => {
    await withTenantOn(app, S, async (tx) => {
      expect(await isMember(tx, S, ids.lastYear, Y - 1)).toBe(true);
      expect(await isMember(tx, S, ids.lastYear, Y)).toBe(false);
    });
  });
});

describe("membershipDisplay（表示のしかた・§5.12）", () => {
  it("受付期間中: approved → member、applied → pending、昨年度 approved で今年度なし → renewal_pending、declined → not_member", async () => {
    await withTenantOn(app, S, async (tx) => {
      expect(await membershipDisplay(tx, S, ids.approved, Y, DURING)).toBe("member");
      expect(await membershipDisplay(tx, S, ids.applied, Y, DURING)).toBe("pending");
      expect(await membershipDisplay(tx, S, ids.lastYear, Y, DURING)).toBe("renewal_pending");
      expect(await membershipDisplay(tx, S, ids.declined, Y, DURING)).toBe("not_member");
      expect(await membershipDisplay(tx, S, ids.none, Y, DURING)).toBe("not_member");
      // renewal_pending でも isMember は false
      expect(await isMember(tx, S, ids.lastYear, Y)).toBe(false);
    });
  });

  it("締切後は昨年度の会員も not_member", async () => {
    await withTenantOn(app, S, async (tx) => {
      expect(await membershipDisplay(tx, S, ids.lastYear, Y, AFTER)).toBe("not_member");
      expect(await membershipDisplay(tx, S, ids.approved, Y, AFTER)).toBe("member");
    });
  });

  it("受付も取り込みもない年度は no_data（approved の行があっても）", async () => {
    await withTenantOn(app, S, async (tx) => {
      expect(await membershipDisplay(tx, S, ids.approved, NO_DATA_YEAR, DURING)).toBe("no_data");
      expect(await membershipDisplay(tx, S, ids.none, NO_DATA_YEAR, DURING)).toBe("no_data");
      // 判定そのものは行のとおり
      expect(await isMember(tx, S, ids.approved, NO_DATA_YEAR)).toBe(true);
    });
  });

  it("まとめて読んでも 1 人ずつと同じ結果", async () => {
    await withTenantOn(app, S, async (tx) => {
      const all = await membershipDisplays(tx, S, Object.values(ids), Y, DURING);
      expect(all.get(ids.approved)).toBe("member");
      expect(all.get(ids.applied)).toBe("pending");
      expect(all.get(ids.lastYear)).toBe("renewal_pending");
      expect(all.get(ids.declined)).toBe("not_member");
      expect(all.get(ids.none)).toBe("not_member");
      expect(await membershipDisplays(tx, S, [], Y, DURING)).toEqual(new Map());
    });
  });
});
