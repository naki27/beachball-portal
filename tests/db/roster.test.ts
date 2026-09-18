import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, members, teamMembers, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { normalizeName } from "@/lib/normalize";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer, getRoster, leavePlayer, UNDO_LEAVE_WINDOW_MS, undoLeave, updatePlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 選手一覧（設計書 §5.11 の受け入れ条件・§3.2 の見せる範囲）。操作は app_user、準備と後片付けは app_owner
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const S = SAWARA_ASSOCIATION_ID;
const tag = `名簿${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const ids = { adminA: "", adminB: "", player: "", stranger: "", tenantAdmin: "" };
let teamX = "";
let teamY = "";
let otherAssociationId = "";
let otherTeamId = "";

const person = (name: string, extra: Record<string, unknown> = {}) => ({
  name: `${tag} ${name}`,
  kana: "",
  birthDate: "1990-04-01",
  sex: "male",
  ...extra,
});

async function statusOf(run: () => Promise<unknown>): Promise<number | "ok"> {
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
    const [u] = await owner.insert(users).values({ email: `roster-${key}-${random()}@example.com` }).returning({ id: users.id });
    ids[key] = u.id;
  }
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: ids.tenantAdmin }));
  const base = { kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false };
  teamX = (await registerTeam(app, S, ids.adminA, { ...base, name: `${tag} X` })).id;
  teamY = (await registerTeam(app, S, ids.adminB, { ...base, name: `${tag} Y` })).id;
  const [other] = await owner.insert(associations).values({ name: "名簿テスト協会", slug: `roster-${random()}` }).returning({ id: associations.id });
  otherAssociationId = other.id;
  const [otherTeam] = await withTenantOn(owner, otherAssociationId, (tx) =>
    tx.insert(teams).values({ associationId: otherAssociationId, name: "よその協会のチーム" }).returning({ id: teams.id }),
  );
  otherTeamId = otherTeam.id;
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(teams).where(inArray(teams.id, [teamX, teamY])); // team_members・team_admins は cascade
    await tx.delete(members).where(and(eq(members.associationId, S), like(members.nameNormalized, `${normalizeName(tag)}%`)));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, ids.tenantAdmin));
  });
  await withTenantOn(owner, otherAssociationId, (tx) => tx.delete(teams).where(eq(teams.associationId, otherAssociationId)));
  await owner.delete(associations).where(eq(associations.id, otherAssociationId));
  await owner.delete(users).where(inArray(users.id, Object.values(ids)));
  await closeDb(owner);
  await closeDb(app);
});

async function countMembers(name: string): Promise<number> {
  const rows = await withTenantOn(owner, S, (tx) =>
    tx.select({ id: members.id }).from(members).where(and(eq(members.associationId, S), eq(members.nameNormalized, normalizeName(`${tag} ${name}`)))),
  );
  return rows.length;
}

describe("追加（保存時に名寄せ）", () => {
  it("代表者が追加すると人物が作られ、選手一覧に載る。同じ人を別のチームに入れても人物は 1 件", async () => {
    const first = await addPlayer(app, as(ids.adminA), S, teamX, person("佐藤"));
    expect(first).toMatchObject({ created: true, needsReview: false });
    const second = await addPlayer(app, as(ids.adminB), S, teamY, person("佐藤", { kana: "さとう" }));
    expect(second).toMatchObject({ memberId: first.memberId, created: false });
    expect(await countMembers("佐藤")).toBe(1);
    // 両方のチームに載っている
    expect((await getRoster(app, as(ids.adminA), S, teamX)).items.map((i) => i.memberId)).toContain(first.memberId);
    expect((await getRoster(app, as(ids.adminB), S, teamY)).items.map((i) => i.memberId)).toContain(first.memberId);
  });

  it("同じチームに同じ人を 2 回は入れられない（409）", async () => {
    expect(await statusOf(() => addPlayer(app, as(ids.adminA), S, teamX, person("佐藤")))).toBe(409);
  });

  it("生年月日が違えば別の人物（要確認）として作られる", async () => {
    const result = await addPlayer(app, as(ids.adminA), S, teamX, person("佐藤", { birthDate: "1991-04-01" }));
    expect(result).toMatchObject({ created: true, needsReview: true });
    expect(await countMembers("佐藤")).toBe(2);
  });

  it("代表者でない人・別のチームの代表者は 403。ほかの協会のチーム ID は 404。入力の誤りは 400", async () => {
    expect(await statusOf(() => addPlayer(app, as(ids.stranger), S, teamX, person("鈴木")))).toBe(403);
    expect(await statusOf(() => addPlayer(app, as(ids.adminB), S, teamX, person("鈴木")))).toBe(403);
    expect(await statusOf(() => addPlayer(app, as(ids.adminA), S, otherTeamId, person("鈴木")))).toBe(404);
    expect(await statusOf(() => addPlayer(app, as(ids.adminA), S, teamX, person("鈴木", { birthDate: "" })))).toBe(400);
    // テナント管理者は追加できる
    expect(await statusOf(() => addPlayer(app, as(ids.tenantAdmin), S, teamX, person("高橋")))).toBe("ok");
  });
});

describe("見せる範囲（§3.2）", () => {
  it("選手にはほかの人の生年月日・年齢・性別を返さず、本人の分は返す。代表者は全員分", async () => {
    // player を「田中」という人物として X に載せ、本人のアカウントに紐づける
    const added = await addPlayer(app, as(ids.adminA), S, teamX, person("田中", { birthDate: "2000-01-01", sex: "female" }));
    await withTenantOn(owner, S, (tx) => tx.update(members).set({ userId: ids.player }).where(eq(members.id, added.memberId)));

    const asPlayer = await getRoster(app, as(ids.player), S, teamX);
    expect(asPlayer.canManage).toBe(false);
    const me = asPlayer.items.find((i) => i.memberId === added.memberId);
    expect(me).toMatchObject({ isSelf: true, personal: { birthDate: "2000-01-01", sex: "female" } });
    expect(asPlayer.items.filter((i) => !i.isSelf).every((i) => i.personal === null)).toBe(true);
    expect(asPlayer.recentlyLeft).toEqual([]);

    const asAdmin = await getRoster(app, as(ids.adminA), S, teamX);
    expect(asAdmin.canManage).toBe(true);
    expect(asAdmin.items.every((i) => i.personal !== null && typeof i.personal.age === "number")).toBe(true);

    // 同じ協会のほかのチームの選手一覧は 403（選手・登録者）
    expect(await statusOf(() => getRoster(app, as(ids.player), S, teamY))).toBe(403);
    expect(await statusOf(() => getRoster(app, as(ids.stranger), S, teamX))).toBe(403);
    // 別の協会のチーム ID を URL の協会の下で指定すると 404
    expect(await statusOf(() => getRoster(app, as(ids.adminA), S, otherTeamId))).toBe(404);
    // 選手は修正できない
    expect(await statusOf(() => updatePlayer(app, as(ids.player), S, teamX, me!.teamMemberId, person("田中")))).toBe(403);
  });
});

describe("外す・元に戻す", () => {
  let teamMemberId = "";
  let memberId = "";
  beforeAll(async () => {
    const added = await addPlayer(app, as(ids.adminA), S, teamX, person("伊藤"));
    teamMemberId = added.teamMemberId;
    memberId = added.memberId;
    await addPlayer(app, as(ids.adminB), S, teamY, person("伊藤"));
  });

  it("外すと left_at・left_by が入り、人物とほかのチームの選手一覧はそのまま。代表者は deleted_at を入れられない", async () => {
    await leavePlayer(app, as(ids.adminA), S, teamX, teamMemberId);
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamMembers).where(eq(teamMembers.id, teamMemberId)));
    expect(row.leftAt).not.toBeNull();
    expect(row.leftBy).toBe(ids.adminA);
    expect(row.deletedAt).toBeNull();
    expect((await getRoster(app, as(ids.adminA), S, teamX)).items.map((i) => i.memberId)).not.toContain(memberId);
    expect((await getRoster(app, as(ids.adminB), S, teamY)).items.map((i) => i.memberId)).toContain(memberId);
    expect(await countMembers("伊藤")).toBe(1);
    // 2 回目は 409
    expect(await statusOf(() => leavePlayer(app, as(ids.adminA), S, teamX, teamMemberId))).toBe(409);
  });

  it("外した本人には「外しました［元に戻す］」が出る。別の代表者は戻せない（403）", async () => {
    expect((await getRoster(app, as(ids.adminA), S, teamX)).recentlyLeft.map((r) => r.teamMemberId)).toEqual([teamMemberId]);
    expect((await getRoster(app, as(ids.tenantAdmin), S, teamX)).recentlyLeft).toEqual([]);
    expect(await statusOf(() => undoLeave(app, as(ids.tenantAdmin), S, teamX, teamMemberId))).toBe(403);
  });

  it("30 分を過ぎると戻せない（409）。30 分以内なら本人は戻せる", async () => {
    const late = new Date(Date.now() + UNDO_LEAVE_WINDOW_MS + 1000);
    expect(await statusOf(() => undoLeave(app, as(ids.adminA), S, teamX, teamMemberId, late))).toBe(409);
    await undoLeave(app, as(ids.adminA), S, teamX, teamMemberId);
    expect((await getRoster(app, as(ids.adminA), S, teamX)).items.map((i) => i.memberId)).toContain(memberId);
    expect((await getRoster(app, as(ids.adminA), S, teamX)).recentlyLeft).toEqual([]);
  });

  it("30 分を過ぎたあとにもう一度追加すると、名寄せで同じ人物に結びつく（人物は増えない）", async () => {
    await leavePlayer(app, as(ids.adminA), S, teamX, teamMemberId);
    await withTenantOn(owner, S, (tx) =>
      tx.update(teamMembers).set({ leftAt: new Date(Date.now() - UNDO_LEAVE_WINDOW_MS - 60_000) }).where(eq(teamMembers.id, teamMemberId)),
    );
    expect((await getRoster(app, as(ids.adminA), S, teamX)).recentlyLeft).toEqual([]);
    const again = await addPlayer(app, as(ids.adminA), S, teamX, person("伊藤"));
    expect(again).toMatchObject({ memberId, created: false });
    expect(again.teamMemberId).not.toBe(teamMemberId);
    expect(await countMembers("伊藤")).toBe(1);
  });
});

describe("修正", () => {
  it("代表者は修正でき、正規化列も変わる。同じ人物を載せるほかのチームにも反映される", async () => {
    const added = await addPlayer(app, as(ids.adminA), S, teamX, person("渡辺"));
    await addPlayer(app, as(ids.adminB), S, teamY, person("渡辺"));
    await updatePlayer(app, as(ids.adminA), S, teamX, added.teamMemberId, person("渡邊", { kana: "わたなべ" }));
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, added.memberId)));
    expect(row).toMatchObject({ name: `${tag} 渡邊`, kana: "わたなべ", nameNormalized: normalizeName(`${tag} 渡邊`), kanaNormalized: "ワタナベ" });
    expect((await getRoster(app, as(ids.adminB), S, teamY)).items.find((i) => i.memberId === added.memberId)?.name).toBe(`${tag} 渡邊`);
    expect(await statusOf(() => updatePlayer(app, as(ids.adminA), S, teamX, added.teamMemberId, { ...person("渡邊"), name: "" }))).toBe(400);
    expect(await statusOf(() => updatePlayer(app, as(ids.adminA), S, teamX, "not-a-uuid", person("渡邊")))).toBe(404);
  });
});
