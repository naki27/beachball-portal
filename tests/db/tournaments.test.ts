import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, categoryPresets, teams, tournamentCategories, tournaments, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { createTournament, editTournament, getTournamentForAdmin, listTournamentsForAdmin } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { endOfDayTokyo, startOfDayTokyo } from "@/lib/date";
import { entryState } from "@/lib/deadline";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 大会の管理（設計書 §5.4・B-04）。準備は app_owner、検査はアプリと同じ app_user（DATABASE_URL）で行う
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `大会${random()}`;

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const input = (over: Record<string, unknown> = {}) => ({
  name: `${tag} 秋季大会`,
  eventDate: "2026-11-23",
  ageReferenceDate: "",
  venue: "早良体育館",
  description: "参加費 3000円",
  entryStartDate: "2026-09-01",
  entryEndDate: "2026-09-30",
  teamSizeMin: "4",
  teamSizeMax: "7",
  maxEntries: "",
  status: "draft",
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

let adminId = "";
let teamAdminId = "";
let otherAssociationId = "";
let otherAdminId = "";

beforeAll(async () => {
  const [admin] = await owner.insert(users).values({ email: `tn-admin-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  adminId = admin.id;
  const [rep] = await owner.insert(users).values({ email: `tn-rep-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  teamAdminId = rep.id;
  const [other] = await owner
    .insert(associations)
    .values({ name: `${tag} 別協会`, slug: `tn-${random()}` })
    .returning({ id: associations.id });
  otherAssociationId = other.id;
  const [otherAdmin] = await owner.insert(users).values({ email: `tn-other-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  otherAdminId = otherAdmin.id;

  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: adminId }));
  await withTenantOn(owner, otherAssociationId, (tx) =>
    tx.insert(associationAdmins).values({ associationId: otherAssociationId, userId: otherAdminId }),
  );
  // 代表者（× の行の確認用）
  await registerTeam(app, S, teamAdminId, {
    name: `${tag} チーム`,
    kana: null,
    contactEmail: null,
    contactPhone: null,
    membershipRenewalTarget: false,
  });
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(tournaments).where(and(eq(tournaments.associationId, S), inArray(tournaments.createdBy, [adminId, teamAdminId])));
    // チームを消すと代表者の行（team_admins）も外部キーの cascade で消える
    await tx.delete(teams).where(and(eq(teams.associationId, S), eq(teams.createdBy, teamAdminId)));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, adminId));
  });
  await withTenantOn(owner, otherAssociationId, async (tx) => {
    // 大会を消すと部（tournament_categories）も cascade で消えるので、そのあとにプリセットを消せる
    await tx.delete(tournaments).where(eq(tournaments.associationId, otherAssociationId));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, otherAssociationId));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, otherAssociationId));
  });
  await owner.delete(associations).where(eq(associations.id, otherAssociationId));
  await owner.delete(users).where(inArray(users.id, [adminId, teamAdminId, otherAdminId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("作成と編集（テナント管理者だけ・§3.2 manageTournaments）", () => {
  it("管理者は作れる。日付は日本時間の 0:00 と 23:59:59 で保存される", async () => {
    const created = await createTournament(app, as(adminId), S, input());
    expect(created.status).toBe("draft");
    expect(created.entryStartAt).toEqual(startOfDayTokyo({ year: 2026, month: 9, day: 1 }));
    expect(created.entryEndAt).toEqual(endOfDayTokyo({ year: 2026, month: 9, day: 30 }));
    // 年齢の基準日は空欄だったので開催日（§14-21）
    expect(created.ageReferenceDate).toEqual({ year: 2026, month: 11, day: 23 });
    expect(created.teamSizeMin).toBe(4);
    expect(created.maxEntries).toBeNull();

    // 締切の瞬間までは受付、その 1 ミリ秒後は締切後（TZ=UTC でも同じ）
    const open = { ...created, status: "open" as const };
    expect(entryState(open, { entryEndAt: null }, created.entryEndAt)).toBe("open");
    expect(entryState(open, { entryEndAt: null }, new Date(created.entryEndAt.getTime() + 1))).toBe("closed");
  });

  it("代表者は 403（画面を隠すだけにしない）", async () => {
    expect(await statusOf(() => createTournament(app, as(teamAdminId), S, input()))).toBe(403);
    expect(await statusOf(() => listTournamentsForAdmin(app, as(teamAdminId), S))).toBe(403);
  });

  it("状態を open にでき、一覧に出る", async () => {
    const created = await createTournament(app, as(adminId), S, input({ name: `${tag} 受付中` }));
    const updated = await editTournament(app, as(adminId), S, created.id, input({ name: `${tag} 受付中`, status: "open" }));
    expect(updated.status).toBe("open");
    const rows = await listTournamentsForAdmin(app, as(adminId), S);
    const row = rows.find((r) => r.id === created.id);
    expect(row?.status).toBe("open");
    expect(row?.categories).toBe(0);
  });

  it("入力の誤りは 400（欄の名前も返す）", async () => {
    const result = await createTournament(app, as(adminId), S, input({ teamSizeMin: "8" })).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(TeamError);
    if (result instanceof TeamError) {
      expect(result.status).toBe(400);
      expect(result.extra.field).toBe("teamSizeMax");
    }
  });

  it("ほかの協会の大会は 404（ID を直に指定しても）", async () => {
    const mine = await createTournament(app, as(adminId), S, input({ name: `${tag} 早良だけ` }));
    expect(await statusOf(() => getTournamentForAdmin(app, as(otherAdminId), otherAssociationId, mine.id))).toBe(404);
    expect(await statusOf(() => editTournament(app, as(otherAdminId), otherAssociationId, mine.id, input()))).toBe(404);
    // 別の協会の管理者は、その協会の大会なら作れる
    expect(await statusOf(() => createTournament(app, as(otherAdminId), otherAssociationId, input({ name: `${tag} 別協会の大会` })))).toBe("ok");
    // 早良の管理者は別の協会では 403
    expect(await statusOf(() => listTournamentsForAdmin(app, as(adminId), otherAssociationId))).toBe(403);
    expect(await statusOf(() => getTournamentForAdmin(app, as(adminId), S, "こわれた-id"))).toBe(404);
  });
});

// 早良区協会のプリセットは seed の 18 件を数えるテストがあるので、この節では別の協会で試す
describe("設定値の整合性（表をまたぐ分・§5.4）", () => {
  const A = () => otherAssociationId;
  const actor = () => as(otherAdminId);

  // 部を 1 つ付けた大会を作る（部の管理は B-05。ここでは直接入れる）
  async function withCategory(over: Record<string, unknown> = {}, category: { courtSize?: number; entryEndAt?: Date | null } = {}) {
    const created = await createTournament(app, actor(), A(), input({ name: `${tag} 部あり ${random()}`, ...over }));
    await withTenantOn(owner, A(), async (tx) => {
      const [preset] = await tx
        .insert(categoryPresets)
        .values({
          associationId: A(),
          code: `tn_${random()}`,
          labelDefault: "混合フリーの部",
          gender: "mixed",
          ruleType: "free",
          courtSize: category.courtSize ?? 4,
        })
        .returning({ id: categoryPresets.id });
      await tx.insert(tournamentCategories).values({
        associationId: A(),
        tournamentId: created.id,
        presetId: preset.id,
        code: "x_free",
        label: "混合フリーの部",
        entryEndAt: category.entryEndAt ?? null,
      });
    });
    return created;
  }

  it("参加人数の下限が部のコートの人数より少ないと 409", async () => {
    const created = await withCategory({}, { courtSize: 6 });
    const result = await editTournament(app, actor(), A(), created.id, input({ name: created.name, teamSizeMin: "4", teamSizeMax: "7" })).catch(
      (e: unknown) => e,
    );
    expect(result).toBeInstanceOf(TeamError);
    if (result instanceof TeamError) {
      expect(result.status).toBe(409);
      expect(result.message).toContain("コートに出る人数");
      expect(result.extra.field).toBe("teamSizeMin");
    }
    // 下限を 6 にすれば保存できる
    expect(
      await statusOf(() => editTournament(app, actor(), A(), created.id, input({ name: created.name, teamSizeMin: "6", teamSizeMax: "7" }))),
    ).toBe("ok");
  });

  it("部の締切より後に申し込みの開始日を動かすと 409", async () => {
    const created = await withCategory({}, { entryEndAt: endOfDayTokyo({ year: 2026, month: 9, day: 10 }) });
    expect(await statusOf(() => editTournament(app, actor(), A(), created.id, input({ name: created.name, entryStartDate: "2026-09-20" })))).toBe(409);
    expect(await statusOf(() => editTournament(app, actor(), A(), created.id, input({ name: created.name, entryStartDate: "2026-09-01" })))).toBe("ok");
  });

  it("部がなければ表をまたぐ検証はしない（作成時も同じ）", async () => {
    const created = await createTournament(app, actor(), A(), input({ name: `${tag} 部なし`, teamSizeMin: "1", teamSizeMax: "1" }));
    expect(created.teamSizeMin).toBe(1);
  });
});
