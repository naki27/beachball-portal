import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, categoryPresets, members, teams, tournaments, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, editCategory, getCategoriesForAdmin } from "@/lib/admin/categories";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { getEntryFormData } from "@/lib/entries/entry-form";
import { TeamError } from "@/lib/teams/errors";
import { registerIndividual } from "@/lib/teams/self";
import { registerTeam, setTeamStatus } from "@/lib/teams/teams";

// 申込の入力ページが要る材料（設計書 §5.5・B-07）。選手枠は B-09、送信は B-10
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `申込${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

// 判定の「今」を固定する（サーバーの TZ に関係なく同じ結果になる）
const NOW = new Date("2026-09-20T03:00:00Z");

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

let A = "";
let adminId = "";
let repId = "";
let strangerId = "";
let openId = "";
let draftId = "";
let pastId = "";
let mainTeamId = "";
let inactiveTeamId = "";
const presetIds: Record<string, string> = {};

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `ent-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `ent-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `ent-other-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId, strangerId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `ent-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  await withTenantOn(owner, A, async (tx) => {
    const rows = await tx
      .insert(categoryPresets)
      .values([
        { associationId: A, code: "m_40", labelDefault: "男子40歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 40, sortOrder: 10 },
        { associationId: A, code: "w_free", labelDefault: "女子フリーの部", gender: "female", ruleType: "free", sortOrder: 20 },
      ])
      .returning({ id: categoryPresets.id, code: categoryPresets.code });
    for (const row of rows) presetIds[row.code] = row.id;
  });

  // 代表を務めるチーム 1 つと、無効にしたチーム 1 つ、個人登録 1 つ
  const main = await registerTeam(app, A, repId, {
    name: `${tag} さくら`,
    kana: null,
    contactEmail: null,
    contactPhone: null,
    membershipRenewalTarget: false,
  });
  mainTeamId = main.id;
  const inactive = await registerTeam(
    app,
    A,
    repId,
    { name: `${tag} 休んでいるチーム`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false },
    { confirmSameName: true },
  );
  inactiveTeamId = inactive.id;
  await setTeamStatus(app, as(repId), A, inactiveTeamId, "inactive");
  await registerIndividual(app, as(repId), A, { name: `${tag} 本人`, kana: null, birthDate: "1980-05-01", sex: "male" });

  openId = (await createTournament(app, as(adminId), A, input({ name: `${tag} 受付中` }))).id;
  draftId = (await createTournament(app, as(adminId), A, input({ name: `${tag} 準備中`, status: "draft" }))).id;
  pastId = (await createTournament(app, as(adminId), A, input({ name: `${tag} 締切後`, entryStartDate: "2026-07-01", entryEndDate: "2026-08-31" }))).id;
  for (const id of [openId, draftId, pastId]) {
    await addCategoriesFromPresets(app, as(adminId), A, id, { presetIds: [presetIds.m_40, presetIds.w_free] });
  }
});

afterAll(async () => {
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(associations).where(eq(associations.id, A));
  await owner.delete(users).where(inArray(users.id, [adminId, repId, strangerId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("入力ページを開けるか（§5.5・§3.1）", () => {
  it("未ログインは 403（リダイレクトしない）", async () => {
    expect(await statusOf(() => getEntryFormData(app, ANONYMOUS, A, openId, NOW))).toBe(403);
  });

  it("準備中の大会・でたらめな ID は 404", async () => {
    expect(await statusOf(() => getEntryFormData(app, as(repId), A, draftId, NOW))).toBe(404);
    expect(await statusOf(() => getEntryFormData(app, as(repId), A, "こわれた-id", NOW))).toBe(404);
  });

  it("締切後は 409。テナント管理者は開ける（§3.2）", async () => {
    const result = await getEntryFormData(app, as(repId), A, pastId, NOW).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(TeamError);
    if (result instanceof TeamError) {
      expect(result.status).toBe(409);
      expect(result.message).toContain("終了");
    }
    const admin = await getEntryFormData(app, as(adminId), A, pastId, NOW);
    expect(admin.isAssociationAdmin).toBe(true);
    // 管理者には締切後の部も選べる形で出す
    expect(admin.categories.every((c) => c.selectable)).toBe(true);
  });

  it("受付前も 409", async () => {
    const later = await createTournament(app, as(adminId), A, input({ name: `${tag} これから`, entryStartDate: "2026-10-01", entryEndDate: "2026-10-31" }));
    await addCategoriesFromPresets(app, as(adminId), A, later.id, { presetIds: [presetIds.m_40] });
    const result = await getEntryFormData(app, as(repId), A, later.id, NOW).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(TeamError);
    if (result instanceof TeamError) expect(result.status).toBe(409);
  });
});

describe("チームの候補（§5.5 入力ページ 1）", () => {
  it("代表を務めるチームだけ。個人登録・無効にしたチームは出さない", async () => {
    const data = await getEntryFormData(app, as(repId), A, openId, NOW);
    expect(data.teams.map((t) => t.id)).toEqual([mainTeamId]);
    expect(data.teams.map((t) => t.id)).not.toContain(inactiveTeamId);
    expect(data.teams.some((t) => t.name.includes("本人"))).toBe(false);
  });

  it("代表を務めるチームがない人も開ける（その場で作るため）", async () => {
    const data = await getEntryFormData(app, as(strangerId), A, openId, NOW);
    expect(data.teams).toEqual([]);
    // 送信用のワンタイムの値は開くたびに発行される
    expect(data.token).not.toBe((await getEntryFormData(app, as(strangerId), A, openId, NOW)).token);
  });
});

describe("出場する部（§5.5 入力ページ 2）", () => {
  it("部の条件の文章と有効な締切が付き、締切を過ぎた部は選べない", async () => {
    const view = await getCategoriesForAdmin(app, as(adminId), A, openId);
    const target = view.categories.find((c) => c.code === "w_free");
    if (!target) throw new Error("部がありません");
    // 女子フリーの部だけ先に締め切る（部ごとに判定する・追加仕様 2）
    await editCategory(app, as(adminId), A, openId, target.id, {
      label: "女子フリーの部",
      entryEndDate: "2026-09-10",
      ageReferenceDate: "",
      maxEntries: "",
    });

    const data = await getEntryFormData(app, as(repId), A, openId, NOW);
    const male = data.categories.find((c) => c.label.startsWith("男子"));
    const female = data.categories.find((c) => c.label.startsWith("女子"));
    expect(male?.selectable).toBe(true);
    expect(male?.condition).toContain("40歳以上");
    expect(female?.state).toBe("closed");
    expect(female?.selectable).toBe(false);
    // 1 つでも受け付けている部があれば、ページ自体は開ける
    expect(data.categories.some((c) => c.selectable)).toBe(true);
  });
});
