import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associations, members } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { findMatch, MatchingError, matchKeysOf, type PersonInput, resolveMember } from "@/lib/matching";
import { normalizeName } from "@/lib/normalize";
import { createMember, listMatchCandidates } from "@/lib/repo/members";

// 名寄せの DB 側（設計書 §8.3「探索対象」・ルール 7）。操作は app_user、準備と後片付けは app_owner
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);

let otherId = "";
// テストごとに名前を変えて、ほかのテスト・seed の人物と混ざらないようにする
const tag = `名寄せ${random()}`;
const person = (overrides: Partial<PersonInput> = {}): PersonInput => ({
  name: `${tag} 太郎`,
  kana: "めいよせ たろう",
  birthDate: "1965-05-03",
  sex: "male",
  ...overrides,
});

async function insertMember(associationId: string, p: PersonInput, extra: Partial<typeof members.$inferInsert> = {}) {
  const keys = matchKeysOf(p);
  return withTenantOn(owner, associationId, async (tx) => {
    const created = await createMember(tx, associationId, {
      name: p.name,
      kana: p.kana,
      birthDate: p.birthDate,
      sex: p.sex,
      nameNormalized: keys.nameNormalized,
      kanaNormalized: keys.kanaNormalized,
    });
    if (Object.keys(extra).length > 0) await tx.update(members).set(extra).where(eq(members.id, created.id));
    return created.id;
  });
}

beforeAll(async () => {
  const [other] = await owner
    .insert(associations)
    .values({ name: "名寄せテスト協会", slug: `matching-${random()}` })
    .returning({ id: associations.id });
  otherId = other.id;
});

afterAll(async () => {
  await withTenantOn(owner, S, (tx) =>
    tx.delete(members).where(and(eq(members.associationId, S), like(members.nameNormalized, `${normalizeName(tag)}%`))),
  );
  await withTenantOn(owner, otherId, (tx) => tx.delete(members).where(eq(members.associationId, otherId)));
  await owner.delete(associations).where(eq(associations.id, otherId));
  await closeDb(owner);
  await closeDb(app);
});

describe("探索対象（同じ協会・active / needs_review・削除されていない）", () => {
  it("ほかの協会・merged・削除済みは候補に出ない。needs_review は出る", async () => {
    const p = person({ name: `${tag} 花子`, kana: "めいよせ はなこ", sex: "female" });
    await insertMember(otherId, p);
    const merged = await insertMember(S, p, { status: "merged" });
    await insertMember(S, p, { deletedAt: new Date() });
    const review = await insertMember(S, p, { status: "needs_review" });

    const found = await withTenantOn(app, S, (tx) => listMatchCandidates(tx, S, matchKeysOf(p)));
    expect(found.map((c) => c.id)).toEqual([review]);
    expect(found.map((c) => c.id)).not.toContain(merged);

    // 協会内にいる 1 人（要確認）に結びつく。ほかの協会の同じ人とは結びつけない
    expect(await withTenantOn(app, S, (tx) => findMatch(tx, S, p))).toMatchObject({ rule: "exact", memberId: review });
  });
});

describe("resolveMember（判定に従って結びつける・新しく作る）", () => {
  it("該当なし → 新しく作る（active）。2 回目は同じ人に結びつく（二重登録を防ぐ）", async () => {
    const first = await withTenantOn(app, S, (tx) => resolveMember(tx, S, person()));
    expect(first).toMatchObject({ matchType: "auto_new", rule: "none", created: true, needsReview: false });
    const row = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, first.memberId)));
    expect(row[0]).toMatchObject({
      name: `${tag} 太郎`,
      kana: "めいよせ たろう",
      nameNormalized: normalizeName(`${tag}太郎`),
      kanaNormalized: "メイヨセタロウ",
      status: "active",
    });

    // 表記の揺れ（全角の空白・カタカナのふりがな）でも同じ人
    const again = await withTenantOn(app, S, (tx) => resolveMember(tx, S, person({ name: `${tag}　太郎`, kana: "メイヨセタロウ" })));
    expect(again).toEqual({ memberId: first.memberId, matchType: "auto_exact", rule: "exact", created: false, needsReview: false });
  });

  it("性別だけ違う → 新しく作って新しい側を要確認。既存の人物は変えない（自動でまとめない・ルール 7）", async () => {
    const before = await withTenantOn(app, S, (tx) => listMatchCandidates(tx, S, matchKeysOf(person())));
    const result = await withTenantOn(app, S, (tx) => resolveMember(tx, S, person({ sex: "female" })));
    expect(result).toMatchObject({ rule: "sex_mismatch", created: true, needsReview: true });
    const [created] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, result.memberId)));
    expect(created.status).toBe("needs_review");
    const existing = await withTenantOn(owner, S, (tx) =>
      tx.select().from(members).where(inArray(members.id, before.map((c) => c.id))),
    );
    expect(existing.every((m) => m.status === "active" && m.mergedIntoId === null)).toBe(true);
  });

  it("改姓の可能性（ふりがなと生年月日が一致）→ 新しく作って要確認", async () => {
    const result = await withTenantOn(app, S, (tx) => resolveMember(tx, S, person({ name: `${tag}別姓 太郎` })));
    expect(result).toMatchObject({ rule: "kana_birth", created: true, needsReview: true });
  });

  it("選ばれた人物（picked）はその人。ほかの協会の人物・存在しない人物は選べない", async () => {
    const [target] = await withTenantOn(app, S, (tx) => listMatchCandidates(tx, S, matchKeysOf(person())));
    const picked = await withTenantOn(app, S, (tx) => resolveMember(tx, S, person({ birthDate: "1999-09-09" }), { kind: "picked", memberId: target.id }));
    expect(picked).toEqual({ memberId: target.id, matchType: "picked", rule: "picked", created: false, needsReview: false });

    const otherMember = await insertMember(otherId, person());
    await expect(
      withTenantOn(app, S, (tx) => resolveMember(tx, S, person(), { kind: "picked", memberId: otherMember })),
    ).rejects.toBeInstanceOf(MatchingError);
  });

  it("「いいえ、別の方です」→ 一致する人がいても新しく作って要確認", async () => {
    const result = await withTenantOn(app, S, (tx) => resolveMember(tx, S, person(), { kind: "declined" }));
    expect(result).toMatchObject({ rule: "declined", matchType: "auto_new", created: true, needsReview: true });
  });
});
