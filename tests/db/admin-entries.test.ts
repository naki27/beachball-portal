import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associationAdmins,
  associations,
  categoryPresets,
  exportLogs,
  mailLogs,
  members,
  memberships,
  teams,
  tournaments,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "@/lib/admin/categories";
import { exportEntriesCsv, getAdminEntries, markEntryChecked } from "@/lib/admin/entries";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import type { PlayerSlot } from "@/lib/entries/player-slots";
import { submitEntry } from "@/lib/entries/submit-entry";
import { cancelEntry } from "@/lib/entries/update-entry";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 管理画面の申込一覧と CSV（設計書 §5.5(f)・B-13）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `一覧${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const NOW = new Date("2026-09-20T03:00:00Z");

let A = "";
let adminId = "";
let repId = "";
let teamId = "";
let openId = "";
const presetIds: Record<string, string> = {};
const categoryIds: Record<string, string> = {};
const roster: { memberId: string; name: string; kana: string; birthDate: string; sex: "male" | "female" }[] = [];

const pickSlot = (index: number): PlayerSlot => {
  const p = roster[index];
  return { kind: "pick", memberId: p.memberId, name: p.name, kana: p.kana, birthDate: p.birthDate, sex: p.sex };
};

const submitBody = (over: Record<string, unknown> = {}) => ({
  teamId,
  newTeamName: "",
  teamName: `${tag} さくら`,
  categoryId: categoryIds.m_free,
  slots: [pickSlot(0), pickSlot(1), pickSlot(2), pickSlot(3)],
  note: "",
  token: crypto.randomUUID(),
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

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `adm-ent-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `adm-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `adm-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  await withTenantOn(owner, A, async (tx) => {
    const rows = await tx
      .insert(categoryPresets)
      .values([
        { associationId: A, code: "m_free", labelDefault: "男子フリーの部", gender: "male", ruleType: "free", sortOrder: 10 },
        { associationId: A, code: "m_160", labelDefault: "男子160歳の部", gender: "male", ruleType: "total_age", ruleValue: 160, sortOrder: 20 },
      ])
      .returning({ id: categoryPresets.id, code: categoryPresets.code });
    for (const row of rows) presetIds[row.code] = row.id;
  });

  teamId = (await registerTeam(app, A, repId, { name: `${tag} さくら`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;
  for (const p of [
    { name: `${tag} アキラ`, kana: "あきら", birthDate: "1975-04-01", sex: "male" as const },
    { name: `${tag} イサム`, kana: "いさむ", birthDate: "1978-05-02", sex: "male" as const },
    { name: `${tag} ウシオ`, kana: "うしお", birthDate: "1980-06-03", sex: "male" as const },
    { name: `${tag} エイジ, 二世`, kana: "えいじ", birthDate: "1982-07-04", sex: "male" as const },
  ]) {
    const { memberId } = await addPlayer(app, as(repId), A, teamId, p);
    roster.push({ memberId, ...p });
  }

  openId = (
    await createTournament(app, as(adminId), A, {
      name: `${tag} 受付中`,
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
    })
  ).id;
  await addCategoriesFromPresets(app, as(adminId), A, openId, { presetIds: [presetIds.m_free, presetIds.m_160] });
  const view = await getCategoriesForAdmin(app, as(adminId), A, openId);
  for (const category of view.categories) categoryIds[category.code] = category.id;
}, 60_000);

afterAll(async () => {
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, A));
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(exportLogs).where(eq(exportLogs.associationId, A));
    await tx.delete(memberships).where(eq(memberships.associationId, A));
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(associations).where(eq(associations.id, A));
  await owner.delete(users).where(inArray(users.id, [adminId, repId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("申込一覧（§5.5(f)・§3.2）", () => {
  it("テナント管理者だけが見られる", async () => {
    expect(await statusOf(() => getAdminEntries(app, as(repId), A, openId, NOW))).toBe(403);
    expect(await statusOf(() => getAdminEntries(app, as(adminId), A, crypto.randomUUID(), NOW))).toBe(404);
  });

  it("取消済みの申込は出ない。件数は部ごとに数える", async () => {
    const kept = await submitEntry(app, as(repId), A, openId, submitBody({ teamName: `${tag} 残す` }), NOW);
    const removed = await submitEntry(app, as(repId), A, openId, submitBody({ teamName: `${tag} 取り消す` }), NOW);
    await cancelEntry(app, as(repId), A, removed.entryId, NOW);

    const view = await getAdminEntries(app, as(adminId), A, openId, NOW);
    const ids = view.entries.map((e) => e.entryId);
    expect(ids).toContain(kept.entryId);
    expect(ids).not.toContain(removed.entryId);
    expect(view.countsByCategory.find((c) => c.categoryId === categoryIds.m_free)?.count).toBe(view.entries.length);
  });

  it("「確認済みにする」で印が外れる（§5.5）", async () => {
    // 合計年齢の部は運営の確認対象の印が立つ
    const entry = await submitEntry(
      app,
      as(repId),
      A,
      openId,
      submitBody({ categoryId: categoryIds.m_160, teamName: `${tag} 合計年齢` , slots: [pickSlot(0), pickSlot(1), pickSlot(2), pickSlot(3)] }),
      NOW,
    );
    expect(entry.needsAdminCheck).toBe(true);
    await markEntryChecked(app, as(adminId), A, entry.entryId, NOW);
    const view = await getAdminEntries(app, as(adminId), A, openId, NOW);
    expect(view.entries.find((e) => e.entryId === entry.entryId)?.needsAdminCheck).toBe(false);
    expect(await statusOf(() => markEntryChecked(app, as(repId), A, entry.entryId, NOW))).toBe(403);
  });
});

describe("CSV（§5.5(f)・§5.13）", () => {
  it("生年月日の列はチェックを入れたときだけ出る。BOM 付きで 1 選手 1 行", async () => {
    await submitEntry(app, as(repId), A, openId, submitBody({ teamName: `${tag} CSV` }), NOW);

    const plain = await exportEntriesCsv(app, as(adminId), A, openId, { includeBirthDate: false }, NOW);
    expect(plain.body.startsWith("﻿")).toBe(true);
    expect(plain.body).toContain("申込番号,部,チーム名,選手の順番,氏名");
    expect(plain.body).not.toContain("生年月日");
    expect(plain.body).not.toContain("1975-04-01");
    // カンマを含む氏名は引用符で囲む
    expect(plain.body).toContain(`"${tag} エイジ, 二世"`);
    // 1 選手 1 行（見出しの分を引く）
    expect(plain.body.trimEnd().split("\r\n").length - 1).toBe(plain.rowCount);

    const withBirth = await exportEntriesCsv(app, as(adminId), A, openId, { includeBirthDate: true }, NOW);
    expect(withBirth.body).toContain("生年月日");
    expect(withBirth.body).toContain("1975-04-01");
  });

  it("取消済みの申込は CSV に出ない", async () => {
    const removed = await submitEntry(app, as(repId), A, openId, submitBody({ teamName: `${tag} CSV から消える` }), NOW);
    await cancelEntry(app, as(repId), A, removed.entryId, NOW);
    const csv = await exportEntriesCsv(app, as(adminId), A, openId, { includeBirthDate: false }, NOW);
    expect(csv.body).not.toContain(`${tag} CSV から消える`);
  });

  it("出力すると export_logs に 1 件記録される（誰が・いつ・生年月日を含めたか）", async () => {
    const before = await withTenantOn(owner, A, (tx) => tx.select().from(exportLogs).where(eq(exportLogs.associationId, A)));
    const csv = await exportEntriesCsv(app, as(adminId), A, openId, { includeBirthDate: true }, NOW);
    const after = await withTenantOn(owner, A, (tx) => tx.select().from(exportLogs).where(eq(exportLogs.associationId, A)));
    expect(after.length - before.length).toBe(1);
    const log = after[after.length - 1];
    expect(log.userId).toBe(adminId);
    expect(log.scope).toBe("tournament");
    expect(log.scopeId).toBe(openId);
    expect(log.format).toBe("csv");
    expect(log.includesBirthDate).toBe(true);
    expect(log.rowCount).toBe(csv.rowCount);
    expect(log.year).toBe(2026);
  });

  it("代表者は CSV を出せない（403）", async () => {
    expect(await statusOf(() => exportEntriesCsv(app, as(repId), A, openId, { includeBirthDate: false }, NOW))).toBe(403);
  });
});
