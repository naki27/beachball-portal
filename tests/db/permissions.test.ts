import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, members, platformAdmins, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { ACTIONS, type Action, ANONYMOUS, can, type Principal, type Role, ROLES } from "@/lib/authz";
import { countTrash } from "@/lib/admin/trash";
import { getTeamForAdmin, listTeamsForAdmin } from "@/lib/admin/teams";
import { searchMembersForAdmin } from "@/lib/admin/members";
import { normalizeName } from "@/lib/normalize";
import { getTeamAdmins } from "@/lib/teams/admins";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer, getPlayerForEdit, getRoster, updatePlayer } from "@/lib/teams/roster";
import { editTeam, registerTeam } from "@/lib/teams/teams";

// 権限表のテストとテナント分離のテスト（設計書 §3.2・§12.1）
// 表そのものは src/lib/authz.ts の ACTIONS（唯一のデータ）。ここでは 1a の API の入口を各ロールで呼び、
// ○ は成功・× は 403、ほかの協会の資源は 404 になることを、表から作ったケースで確かめる
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `権限${random()}`;

// 表の列（アンノウンは未ログインなので、API の入口（requireTenantUser）が 403 で返す。tests/unit/api-permissions.test.ts）
const COLUMNS = ["registered", "player", "team_admin", "association_admin"] as const;
type Column = (typeof COLUMNS)[number];

const ids: Record<Column | "platformAdmin" | "otherAdmin", string> = {
  registered: "", player: "", team_admin: "", association_admin: "", platformAdmin: "", otherAdmin: "",
};
const emails: Record<keyof typeof ids, string> = { ...ids };

let otherAssociationId = "";
let teamX = "";
let teamY = "";
let otherTeam = "";
let taroTeamMemberId = "";
let teamYMemberId = "";
const taro = { name: `${tag} 太郎`, kana: "", birthDate: "1992-02-02", sex: "male" };

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const actorOf = (column: Column) => as(ids[column]);

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
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    emails[key] = `perm-${key}-${random()}@example.com`;
    const [u] = await owner.insert(users).values({ email: emails[key], emailVerifiedAt: new Date() }).returning({ id: users.id });
    ids[key] = u.id;
  }

  const [other] = await owner
    .insert(associations)
    .values({ name: `${tag} 別協会`, slug: `perm-${random()}` })
    .returning({ id: associations.id });
  otherAssociationId = other.id;

  const base = { kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false };
  teamX = (await registerTeam(app, S, ids.team_admin, { ...base, name: `${tag} X` })).id;
  otherTeam = (await registerTeam(app, otherAssociationId, ids.otherAdmin, { ...base, name: `${tag} 別` })).id;

  // 選手（太郎）を加え、選手のアカウントに紐づける（§3.2「選手（自チーム）」の判定）
  const added = await addPlayer(app, actorOf("team_admin"), S, teamX, taro);
  taroTeamMemberId = added.teamMemberId;
  await withTenantOn(owner, S, (tx) => tx.update(members).set({ userId: ids.player }).where(eq(members.id, added.memberId)));

  // 代表者の人は、別のチーム（Y）では選手（§3.1 のロールはチームごとに決まる）
  teamY = (await registerTeam(app, S, ids.registered, { ...base, name: `${tag} Y` })).id;
  const hanako = await addPlayer(app, as(ids.registered), S, teamY, { ...taro, name: `${tag} 花子`, sex: "female" });
  await withTenantOn(owner, S, (tx) => tx.update(members).set({ userId: ids.team_admin }).where(eq(members.id, hanako.memberId)));
  teamYMemberId = hanako.teamMemberId;

  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: ids.association_admin }));
  await owner.insert(platformAdmins).values({ userId: ids.platformAdmin });
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(teams).where(inArray(teams.createdBy, Object.values(ids)));
    await tx.delete(members).where(and(eq(members.associationId, S), like(members.nameNormalized, `${normalizeName(tag)}%`)));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, ids.association_admin));
  });
  await withTenantOn(owner, otherAssociationId, (tx) => tx.delete(teams).where(eq(teams.associationId, otherAssociationId)));
  await owner.delete(associations).where(eq(associations.id, otherAssociationId));
  await owner.delete(platformAdmins).where(eq(platformAdmins.userId, ids.platformAdmin));
  await owner.delete(users).where(inArray(users.id, Object.values(ids)));
  await closeDb(owner);
  await closeDb(app);
});

// 表の行（ACTIONS）と、1a でその行を守っている入口の対応。○ のロールで成功し、× のロールで 403 になること
type Case = { action: Action; name: string; run: (actor: Principal & { userId: string }) => Promise<unknown> };

const CASES: readonly Case[] = [
  { action: "viewOwnTeamRoster", name: "選手一覧を見る", run: (a) => getRoster(app, a, S, teamX) },
  { action: "manageRoster", name: "選手の情報を開く", run: (a) => getPlayerForEdit(app, a, S, teamX, taroTeamMemberId) },
  { action: "manageRoster", name: "選手の情報を直す", run: (a) => updatePlayer(app, a, S, teamX, taroTeamMemberId, taro) },
  { action: "manageTeamAdmins", name: "代表者の画面", run: (a) => getTeamAdmins(app, a, S, teamX) },
  { action: "editTeam", name: "チーム情報の編集", run: (a) => editTeam(app, a, S, teamX, { name: `${tag} X` }) },
  { action: "viewOtherTeams", name: "協会のチーム一覧", run: (a) => listTeamsForAdmin(app, a, S, "") },
  { action: "manageMemberships", name: "協会の人物の検索", run: (a) => searchMembersForAdmin(app, a, S, "") },
  { action: "physicalDelete", name: "削除済みデータの件数", run: (a) => countTrash(app, a, S) },
];

describe("権限表（§3.2）どおりに API が応える", () => {
  it("ケースは表の行（ACTIONS）から作っている", () => {
    for (const c of CASES) expect(ACTIONS[c.action]).toBeDefined();
    // 1a の API が守っている行は、すべてケースにしている
    const covered = new Set(CASES.map((c) => c.action));
    for (const action of ["viewOwnTeamRoster", "manageRoster", "manageTeamAdmins", "editTeam", "viewOtherTeams", "manageMemberships", "physicalDelete"] as const) {
      expect(covered.has(action)).toBe(true);
    }
  });

  for (const c of CASES) {
    it.each(COLUMNS)(`${c.name}（${c.action}）: %s`, async (column) => {
      const allowed = can(column as Role, c.action);
      const result = await statusOf(() => c.run(actorOf(column)));
      expect(result).toBe(allowed ? "ok" : 403);
    });
  }

  it("表にない ROLES がないこと（列の取りこぼし）", () => {
    expect([...COLUMNS, "anonymous", "platform_admin"].sort()).toEqual([...ROLES].sort());
  });

  it("運営管理者は、切り替えて入った協会の中でだけ協会の管理者と同じ（§3.2 の※）", async () => {
    const outside = as(ids.platformAdmin);
    expect(await statusOf(() => listTeamsForAdmin(app, outside, S, ""))).toBe(403);
    const entered = { ...outside, isPlatformAdmin: true, enteredAssociationId: S };
    expect(await statusOf(() => listTeamsForAdmin(app, entered, S, ""))).toBe("ok");
    // 入っていない協会では、運営管理者でも協会の管理者にはならない
    expect(await statusOf(() => listTeamsForAdmin(app, { ...entered }, otherAssociationId, ""))).toBe(403);
  });
});

describe("同じ人が、あるチームでは代表者・別のチームでは選手（§3.1 の 2 段の判定）", () => {
  it("代表者を務めるチームの選手一覧は編集でき、選手として載っているだけのチームは編集できない（403）", async () => {
    const both = actorOf("team_admin");
    expect(await statusOf(() => getRoster(app, both, S, teamX))).toBe("ok");
    expect(await statusOf(() => getRoster(app, both, S, teamY))).toBe("ok");
    expect(await statusOf(() => updatePlayer(app, both, S, teamX, taroTeamMemberId, taro))).toBe("ok");
    expect(await statusOf(() => updatePlayer(app, both, S, teamY, teamYMemberId, { ...taro, name: `${tag} 花子`, sex: "female" }))).toBe(403);
    // 選手として見えるのは自分の情報だけ（ほかの人の生年月日は返さない・§3.2）
    const roster = await getRoster(app, both, S, teamY);
    expect(roster.canManage).toBe(false);
    expect(roster.items.find((i) => i.isSelf)?.personal?.birthDate).toBe(taro.birthDate);
  });
});

describe("テナント分離（協会を 2 つ作る・§12.1）", () => {
  it("URL の協会に資源がなければ 404、資源のある協会でも権限がなければ 403（§3.1）", async () => {
    const teamAdmin = actorOf("team_admin");
    // 自分の協会（S）の URL で、ほかの協会のチーム ID → 404
    expect(await statusOf(() => getRoster(app, teamAdmin, S, otherTeam))).toBe(404);
    // ほかの協会（B）の URL で、その協会のチーム ID → その協会では役割がないので 403
    expect(await statusOf(() => getRoster(app, teamAdmin, otherAssociationId, otherTeam))).toBe(403);
    // 自分の協会のチーム ID を、ほかの協会の URL で → 404
    expect(await statusOf(() => getRoster(app, teamAdmin, otherAssociationId, teamX))).toBe(404);
  });

  it("協会の管理者の権限は、その協会の中だけ（管理画面も同じ）", async () => {
    const admin = actorOf("association_admin");
    expect(await statusOf(() => getTeamForAdmin(app, admin, S, teamX))).toBe("ok");
    expect(await statusOf(() => getTeamForAdmin(app, admin, S, otherTeam))).toBe(404);
    expect(await statusOf(() => getTeamForAdmin(app, admin, otherAssociationId, otherTeam))).toBe(403);
    expect(await statusOf(() => countTrash(app, admin, otherAssociationId))).toBe(403);
  });
});
