import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associationAdmins,
  associations,
  categoryPresets,
  entries,
  entryAudits,
  entryPlayers,
  teams,
  tournaments,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, confirmAgeReference, editCategory, getCategoriesForAdmin, removeCategory } from "@/lib/admin/categories";
import { createPreset, editPreset, listPresetsForAdmin, removePreset } from "@/lib/admin/category-presets";
import { createTournament, editTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { endOfDayTokyo } from "@/lib/date";
import { entryState } from "@/lib/deadline";
import { normalizeName } from "@/lib/normalize";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 大会の部の管理（設計書 §5.4・B-05）。準備は app_owner、検査はアプリと同じ app_user（DATABASE_URL）で行う
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `部${random()}`;

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const input = (over: Record<string, unknown> = {}) => ({
  name: `${tag} 大会 ${random()}`,
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
  ...over,
});

async function statusOf(run: () => Promise<unknown>): Promise<"ok" | number> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

let A = ""; // この試験だけの協会
let B = ""; // 別の協会（404 の確認用）
let adminId = "";
let repId = "";
let otherAdminId = "";
let teamId = "";
const presetIds: Record<string, string> = {}; // code → id

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `cat-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `cat-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `cat-other-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId, otherAdminId] = made.map((u) => u.id);

  const rows = await owner
    .insert(associations)
    .values([
      { name: `${tag} 協会`, slug: `cat-a-${random()}` },
      { name: `${tag} 別協会`, slug: `cat-b-${random()}` },
    ])
    .returning({ id: associations.id });
  [A, B] = rows.map((r) => r.id);

  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));
  await withTenantOn(owner, B, (tx) => tx.insert(associationAdmins).values({ associationId: B, userId: otherAdminId }));

  // この協会の「よく使う部門」（本番の 18 件とは別に、試験で使う分だけ作る）
  await withTenantOn(owner, A, async (tx) => {
    const made = await tx
      .insert(categoryPresets)
      .values([
        { associationId: A, code: "m_40", labelDefault: "男子40歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 40, sortOrder: 10 },
        { associationId: A, code: "w_free", labelDefault: "女子フリーの部", gender: "female", ruleType: "free", sortOrder: 20 },
        { associationId: A, code: "x_160", labelDefault: "混合160オーバーの部", gender: "mixed", ruleType: "total_age", ruleValue: 160, sortOrder: 30 },
        { associationId: A, code: "m_6", labelDefault: "男子6人制の部", gender: "male", ruleType: "free", courtSize: 6, sortOrder: 40 },
        { associationId: A, code: "old", labelDefault: "使わない部", gender: "male", ruleType: "free", sortOrder: 50, isActive: false },
      ])
      .returning({ id: categoryPresets.id, code: categoryPresets.code });
    for (const row of made) presetIds[row.code] = row.id;
  });

  const team = await registerTeam(app, A, repId, {
    name: `${tag} チーム`,
    kana: null,
    contactEmail: null,
    contactPhone: null,
    membershipRenewalTarget: false,
  });
  teamId = team.id;
});

afterAll(async () => {
  for (const id of [A, B]) {
    await withTenantOn(owner, id, async (tx) => {
      // 大会を消すと部・申込・申込の選手・履歴は cascade で消える
      await tx.delete(tournaments).where(eq(tournaments.associationId, id));
      await tx.delete(teams).where(eq(teams.associationId, id));
      await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, id));
      await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, id));
    });
  }
  await owner.delete(associations).where(inArray(associations.id, [A, B]));
  await owner.delete(users).where(inArray(users.id, [adminId, repId, otherAdminId]));
  await closeDb(owner);
  await closeDb(app);
});

// 申込を 1 件作る（申込の画面は B-09・B-10。ここでは表に直接入れる）
async function addEntry(tournamentId: string, categoryId: string, birthDate: string, ageAtEvent: number): Promise<string> {
  return withTenantOn(owner, A, async (tx) => {
    const [entry] = await tx
      .insert(entries)
      .values({ associationId: A, tournamentId, categoryId, teamId, createdBy: repId, teamName: `${tag} チーム` })
      .returning({ id: entries.id });
    await tx.insert(entryPlayers).values({
      associationId: A,
      entryId: entry.id,
      position: 1,
      name: "山田太郎",
      birthDate,
      sex: "male",
      ageAtEvent,
      nameNormalized: normalizeName("山田太郎"),
    });
    return entry.id;
  });
}

describe("プリセットからの一括追加（§5.4）", () => {
  it("チェックした部をまとめて追加でき、混合の表記を選べる", async () => {
    const t = await createTournament(app, as(adminId), A, input());
    const result = await addCategoriesFromPresets(app, as(adminId), A, t.id, {
      presetIds: [presetIds.m_40, presetIds.w_free, presetIds.x_160],
      mixedNotation: "mix",
    });
    expect(result).toEqual({ added: 3, skipped: 0 });

    const view = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    expect(view.categories.map((c) => c.code)).toEqual(["m_40", "w_free", "x_160"]);
    // 表示名だけ MIX になり、突合に使う code は変わらない（§5.4 受け入れ条件）
    const mixed = view.categories.find((c) => c.code === "x_160");
    expect(mixed?.label).toBe("MIX160オーバーの部");
    expect(mixed?.ruleValue).toBe(160);
    // 候補には、まだ追加していない・使う設定の部だけが出る（isActive = false は出さない）
    expect(view.presets.filter((p) => !p.added).map((p) => p.code)).toEqual(["m_6"]);
  });

  it("すでにある部は飛ばす（同じ大会に同じ部を 2 つ作らない）", async () => {
    const t = await createTournament(app, as(adminId), A, input());
    await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_40] });
    const again = await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_40, presetIds.w_free] });
    expect(again).toEqual({ added: 1, skipped: 1 });
  });

  it("コートに出る人数が参加人数の下限より多い部は 409", async () => {
    const t = await createTournament(app, as(adminId), A, input({ teamSizeMin: "4" }));
    const result = await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_6] }).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(TeamError);
    if (result instanceof TeamError) {
      expect(result.status).toBe(409);
      expect(result.message).toContain("参加人数の下限");
    }
    // 下限を 6 にすれば入る
    await editTournament(app, as(adminId), A, t.id, input({ name: t.name, teamSizeMin: "6", teamSizeMax: "7" }));
    expect(await statusOf(() => addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_6] }))).toBe("ok");
  });

  it("代表者は 403、別の協会の大会は 404（URL を直に打っても）", async () => {
    const t = await createTournament(app, as(adminId), A, input());
    expect(await statusOf(() => getCategoriesForAdmin(app, as(repId), A, t.id))).toBe(403);
    expect(await statusOf(() => addCategoriesFromPresets(app, as(repId), A, t.id, { presetIds: [presetIds.m_40] }))).toBe(403);
    expect(await statusOf(() => getCategoriesForAdmin(app, as(otherAdminId), B, t.id))).toBe(404);
    expect(await statusOf(() => addCategoriesFromPresets(app, as(otherAdminId), B, t.id, { presetIds: [presetIds.m_40] }))).toBe(404);
    // 別の協会のプリセットは使えない
    expect(await statusOf(() => addCategoriesFromPresets(app, as(otherAdminId), B, t.id, { presetIds: [presetIds.m_40] }))).toBe(404);
  });
});

describe("部ごとの締切・基準日・上限（追加仕様 2）", () => {
  it("部の締切だけを変えられ、ほかの部は大会の締切のまま", async () => {
    const t = await createTournament(app, as(adminId), A, input());
    await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_40, presetIds.w_free] });
    const before = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    const target = before.categories.find((c) => c.code === "m_40");
    if (!target) throw new Error("部がありません");

    await editCategory(app, as(adminId), A, t.id, target.id, {
      label: "男子40歳以上の部(延長)",
      entryEndDate: "2026-10-15",
      ageReferenceDate: "",
      maxEntries: "10",
    });

    const after = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    const extended = after.categories.find((c) => c.code === "m_40");
    const normal = after.categories.find((c) => c.code === "w_free");
    // cleanText が全角の括弧を半角に直す（§8.1 の正規化）
    expect(extended?.label).toBe("男子40歳以上の部(延長)");
    expect(extended?.maxEntries).toBe(10);
    expect(extended?.effectiveEntryEndAt).toEqual(endOfDayTokyo({ year: 2026, month: 10, day: 15 }));
    // 締切を上書きしていない部は大会の締切（§5.4「部門の締切が未設定なら大会の締切」）
    expect(normal?.entryEndAt).toBeNull();
    expect(normal?.effectiveEntryEndAt).toEqual(t.entryEndAt);

    // 10/1 には、延長した部だけまだ受け付ける（受付の可否は部ごと）
    const oct1 = new Date(Date.UTC(2026, 9, 1, 3, 0, 0));
    expect(entryState(t, { entryEndAt: null }, oct1)).toBe("closed");
    expect(entryState(t, { entryEndAt: extended?.entryEndAt ?? null }, oct1)).toBe("open");
  });

  it("大会の申し込みの開始日より前の締切は 409", async () => {
    const t = await createTournament(app, as(adminId), A, input({ entryStartDate: "2026-09-01" }));
    await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_40] });
    const view = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    const id = view.categories[0].id;
    const result = await editCategory(app, as(adminId), A, t.id, id, {
      label: "男子40歳以上の部",
      entryEndDate: "2026-08-20",
      ageReferenceDate: "",
      maxEntries: "",
    }).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(TeamError);
    if (result instanceof TeamError) {
      expect(result.status).toBe(409);
      expect(result.extra.field).toBe("entryEndDate");
    }
  });

  it("「部の締切も大会に揃える」で上書きが外れる（自動では追従しない）", async () => {
    const t = await createTournament(app, as(adminId), A, input());
    await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_40] });
    const view = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    const id = view.categories[0].id;
    await editCategory(app, as(adminId), A, t.id, id, { label: "男子40歳以上の部", entryEndDate: "2026-10-15", ageReferenceDate: "", maxEntries: "" });

    // 揃えるを選ばなければ、大会の締切を変えても部の上書きは残る
    await editTournament(app, as(adminId), A, t.id, input({ name: t.name, entryEndDate: "2026-09-20" }));
    const kept = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    expect(kept.categories[0].entryEndAt).toEqual(endOfDayTokyo({ year: 2026, month: 10, day: 15 }));

    await editTournament(app, as(adminId), A, t.id, input({ name: t.name, entryEndDate: "2026-09-20", syncCategoryDeadlines: true }));
    const synced = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    expect(synced.categories[0].entryEndAt).toBeNull();
    expect(synced.categories[0].effectiveEntryEndAt).toEqual(endOfDayTokyo({ year: 2026, month: 9, day: 20 }));
  });
});

describe("部の削除（§5.4 受け入れ条件）", () => {
  it("申し込みのある部は削除できず、ない部は外せる", async () => {
    const t = await createTournament(app, as(adminId), A, input());
    await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_40, presetIds.w_free] });
    const view = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    const used = view.categories.find((c) => c.code === "m_40");
    const unused = view.categories.find((c) => c.code === "w_free");
    if (!used || !unused) throw new Error("部がありません");
    await addEntry(t.id, used.id, "1980-05-01", 46);

    const result = await removeCategory(app, as(adminId), A, t.id, used.id).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(TeamError);
    if (result instanceof TeamError) {
      expect(result.status).toBe(409);
      expect(result.message).toContain("申し込み");
    }
    expect(await statusOf(() => removeCategory(app, as(adminId), A, t.id, unused.id))).toBe("ok");

    const after = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    expect(after.categories.map((c) => c.code)).toEqual(["m_40"]);
    expect(after.categories[0].entries).toBe(1);
    // 外した部はもう一度追加できる
    expect(await statusOf(() => addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.w_free] }))).toBe("ok");
  });
});

describe("年齢の基準日の変更（§14-21）", () => {
  it("基準日を変えると警告一覧に出て、確定するまで申込の年齢は変わらない", async () => {
    const t = await createTournament(app, as(adminId), A, input({ ageReferenceDate: "2026-11-23" }));
    await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_40] });
    const view = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    const categoryId = view.categories[0].id;
    // 1980-05-01 生まれ: 2026-11-23 時点で 46 歳
    const entryId = await addEntry(t.id, categoryId, "1980-05-01", 46);
    expect((await getCategoriesForAdmin(app, as(adminId), A, t.id)).ageWarnings).toEqual([]);

    // 基準日を誕生日より前に動かすと 45 歳になる
    await editTournament(app, as(adminId), A, t.id, input({ name: t.name, ageReferenceDate: "2026-04-01" }));
    const warned = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    expect(warned.ageWarnings).toHaveLength(1);
    expect(warned.ageWarnings[0].players).toEqual([{ name: "山田太郎", before: 46, after: 45 }]);
    // 押すまでは申込時点の値のまま
    const kept = await withTenantOn(owner, A, (tx) =>
      tx.select({ age: entryPlayers.ageAtEvent }).from(entryPlayers).where(eq(entryPlayers.entryId, entryId)),
    );
    expect(kept[0].age).toBe(46);

    const result = await confirmAgeReference(app, as(adminId), A, t.id);
    expect(result).toEqual({ entries: 1, players: 1 });
    const recalculated = await withTenantOn(owner, A, (tx) =>
      tx.select({ age: entryPlayers.ageAtEvent }).from(entryPlayers).where(eq(entryPlayers.entryId, entryId)),
    );
    expect(recalculated[0].age).toBe(45);
    expect((await getCategoriesForAdmin(app, as(adminId), A, t.id)).ageWarnings).toEqual([]);

    // 履歴が残る。生年月日は入れない（§5.16）
    const audits = await withTenantOn(owner, A, (tx) =>
      tx.select({ action: entryAudits.action, before: entryAudits.before, after: entryAudits.after }).from(entryAudits).where(eq(entryAudits.entryId, entryId)),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("recalc_age");
    expect(JSON.stringify(audits[0])).not.toContain("1980");
  });

  it("部ごとの基準日は大会の基準日より優先される", async () => {
    const t = await createTournament(app, as(adminId), A, input({ ageReferenceDate: "2026-11-23" }));
    await addCategoriesFromPresets(app, as(adminId), A, t.id, { presetIds: [presetIds.m_40] });
    const view = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    const categoryId = view.categories[0].id;
    await addEntry(t.id, categoryId, "1980-05-01", 46);

    await editCategory(app, as(adminId), A, t.id, categoryId, {
      label: "男子40歳以上の部",
      entryEndDate: "",
      ageReferenceDate: "2026-04-01",
      maxEntries: "",
    });
    const after = await getCategoriesForAdmin(app, as(adminId), A, t.id);
    expect(after.categories[0].effectiveAgeReferenceDate).toEqual({ year: 2026, month: 4, day: 1 });
    expect(after.ageWarnings[0].players).toEqual([{ name: "山田太郎", before: 46, after: 45 }]);
  });
});

describe("「よく使う部門」の管理（テナント設定）", () => {
  it("足す・直す（記号は変わらない）・使われていれば消せない", async () => {
    const created = await createPreset(app, as(adminId), A, {
      code: `w_50_${random()}`,
      labelDefault: "女子50歳以上の部",
      gender: "female",
      ruleType: "min_age",
      ruleValue: "50",
      courtSize: "4",
      mixedMinMale: "1",
      mixedMinFemale: "2",
      sortOrder: "60",
      isActive: true,
    });
    expect(created.ruleValue).toBe(50);

    // 記号を送っても変わらない（前回コピーの突合が壊れないように・§5.4）
    await editPreset(app, as(adminId), A, created.id, {
      code: "別の記号",
      labelDefault: "女子50歳以上の部(改)",
      gender: "female",
      ruleType: "min_age",
      ruleValue: "55",
      courtSize: "4",
      mixedMinMale: "1",
      mixedMinFemale: "2",
      sortOrder: "61",
      isActive: false,
    });
    const rows = await listPresetsForAdmin(app, as(adminId), A);
    const edited = rows.find((p) => p.id === created.id);
    expect(edited?.code).toBe(created.code);
    expect(edited?.labelDefault).toBe("女子50歳以上の部(改)");
    expect(edited?.ruleValue).toBe(55);
    expect(edited?.isActive).toBe(false);

    // 同じ記号は 409
    const duplicate = await createPreset(app, as(adminId), A, {
      code: created.code,
      labelDefault: "重なる部",
      gender: "female",
      ruleType: "free",
      ruleValue: "",
      courtSize: "4",
      mixedMinMale: "1",
      mixedMinFemale: "2",
      sortOrder: "62",
      isActive: true,
    }).catch((e: unknown) => e);
    expect(duplicate).toBeInstanceOf(TeamError);
    if (duplicate instanceof TeamError) expect(duplicate.status).toBe(409);

    // 使われていなければ消せる
    expect(await statusOf(() => removePreset(app, as(adminId), A, created.id))).toBe("ok");

    // 大会で使っているプリセットは 409
    const used = rows.find((p) => p.code === "m_40");
    if (!used) throw new Error("プリセットがありません");
    expect(used.usedBy).toBeGreaterThan(0);
    const blocked = await removePreset(app, as(adminId), A, used.id).catch((e: unknown) => e);
    expect(blocked).toBeInstanceOf(TeamError);
    if (blocked instanceof TeamError) expect(blocked.status).toBe(409);
  });

  it("代表者は 403、別の協会のプリセットは 404", async () => {
    expect(await statusOf(() => listPresetsForAdmin(app, as(repId), A))).toBe(403);
    expect(await statusOf(() => editPreset(app, as(otherAdminId), B, presetIds.m_40, { labelDefault: "のっとり" }))).toBe(404);
    expect(await statusOf(() => removePreset(app, as(otherAdminId), B, presetIds.m_40))).toBe(404);
  });
});
