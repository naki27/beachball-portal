import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, members, teamInvitations, teamMembers, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { deleteTeamMemberRow, getMemberForAdmin, searchMembersForAdmin, updateMemberByAdmin } from "@/lib/admin/members";
import { assignTeamAdmin, deleteTeam, getTeamForAdmin, listTeamsForAdmin } from "@/lib/admin/teams";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { normalizeName } from "@/lib/normalize";
import { TeamError } from "@/lib/teams/errors";
import { invitePlayer } from "@/lib/teams/invitations";
import { addPlayer, getRoster } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 管理画面: チームとメンバー（設計書 §4.2 #15・#16・§5.16「論理削除」）。テナント管理者だけ
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const S = SAWARA_ASSOCIATION_ID;
const tag = `運営${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const ids = { captain: "", other: "", tenantAdmin: "" };
const emails = { captain: "", other: "", tenantAdmin: "" };
let teamId = "";

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
    emails[key] = `admin-ui-${key}-${random()}@example.com`;
    const [u] = await owner.insert(users).values({ email: emails[key], emailVerifiedAt: new Date() }).returning({ id: users.id });
    ids[key] = u.id;
  }
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: ids.tenantAdmin }));
  teamId = (await registerTeam(app, S, ids.captain, { name: `${tag} チーム`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(teams).where(inArray(teams.createdBy, Object.values(ids)));
    await tx.delete(members).where(and(eq(members.associationId, S), like(members.nameNormalized, `${normalizeName(tag)}%`)));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, ids.tenantAdmin));
  });
  await owner.delete(users).where(inArray(users.id, Object.values(ids)));
  await closeDb(owner);
  await closeDb(app);
});

describe("チーム管理", () => {
  it("一覧・検索はテナント管理者だけ（代表者は 403）。件数（代表者・選手）が出る", async () => {
    expect(await statusOf(() => listTeamsForAdmin(app, as(ids.captain), S, ""))).toBe(403);
    await addPlayer(app, as(ids.captain), S, teamId, { name: `${tag} 太郎`, kana: "", birthDate: "1990-01-01", sex: "male" });
    const rows = await listTeamsForAdmin(app, as(ids.tenantAdmin), S, tag);
    expect(rows.map((r) => r.id)).toEqual([teamId]);
    expect(rows[0]).toMatchObject({ admins: 1, players: 1, status: "active" });
    expect((await listTeamsForAdmin(app, as(ids.tenantAdmin), S, "存在しないチーム名xyz")).length).toBe(0);
  });

  it("代表者の付け替え: アカウントのあるアドレスを承諾なしで代表者にする。ない・すでに代表者は 409", async () => {
    expect(await statusOf(() => assignTeamAdmin(app, as(ids.tenantAdmin), S, teamId, `nobody-${random()}@example.com`))).toBe(409);
    const { userId } = await assignTeamAdmin(app, as(ids.tenantAdmin), S, teamId, emails.other.toUpperCase());
    expect(userId).toBe(ids.other);
    const detail = await getTeamForAdmin(app, as(ids.tenantAdmin), S, teamId);
    expect(detail.admins.map((a) => a.userId).sort()).toEqual([ids.captain, ids.other].sort());
    expect(detail.admins.find((a) => a.userId === ids.other)?.grantedBy).toBe(ids.tenantAdmin);
    expect(await statusOf(() => assignTeamAdmin(app, as(ids.tenantAdmin), S, teamId, emails.other))).toBe(409);
    expect(await statusOf(() => assignTeamAdmin(app, as(ids.captain), S, teamId, emails.other))).toBe(403);
  });

  it("削除（論理）: 返事待ちの招待を取り消し、一覧・チームのページから消える。代表者は削除できない", async () => {
    const roster = await getRoster(app, as(ids.captain), S, teamId);
    const inv = await invitePlayer(app, as(ids.captain), S, teamId, { memberId: roster.items[0].memberId, email: `admin-ui-x-${random()}@example.com` });
    expect(await statusOf(() => deleteTeam(app, as(ids.captain), S, teamId))).toBe(403);
    await deleteTeam(app, as(ids.tenantAdmin), S, teamId);
    const [team] = await withTenantOn(owner, S, (tx) => tx.select().from(teams).where(eq(teams.id, teamId)));
    expect(team.deletedAt).not.toBeNull();
    expect(team.deletedBy).toBe(ids.tenantAdmin);
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.id, inv.invitationId)));
    expect(row.status).toBe("cancelled");
    expect((await listTeamsForAdmin(app, as(ids.tenantAdmin), S, tag)).length).toBe(0);
    expect(await statusOf(() => getRoster(app, as(ids.captain), S, teamId))).toBe(404);
    expect(await statusOf(() => deleteTeam(app, as(ids.tenantAdmin), S, teamId))).toBe(404);
  });
});

describe("メンバー管理", () => {
  let team2 = "";
  let memberId = "";
  let teamMemberId = "";
  beforeAll(async () => {
    team2 = (await registerTeam(app, S, ids.captain, { name: `${tag} チーム 2`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;
    const added = await addPlayer(app, as(ids.captain), S, team2, { name: `${tag} 花子`, kana: "はなこ", birthDate: "1995-05-05", sex: "female" });
    memberId = added.memberId;
    teamMemberId = added.teamMemberId;
  });

  it("検索（氏名・ふりがな）は管理者だけ。生年月日・年齢・性別と、載っている選手一覧が見える", async () => {
    expect(await statusOf(() => searchMembersForAdmin(app, as(ids.captain), S, "花子"))).toBe(403);
    const byName = await searchMembersForAdmin(app, as(ids.tenantAdmin), S, `${tag} 花子`);
    expect(byName.map((m) => m.id)).toEqual([memberId]);
    expect(byName[0]).toMatchObject({ birthDate: "1995-05-05", sex: "female", status: "active", linked: false });
    expect((await searchMembersForAdmin(app, as(ids.tenantAdmin), S, "ハナコ")).map((m) => m.id)).toContain(memberId);
    const detail = await getMemberForAdmin(app, as(ids.tenantAdmin), S, memberId);
    expect(detail.teams.map((t) => t.teamMemberId)).toEqual([teamMemberId]);
    expect(detail.linkedEmail).toBeNull();
  });

  it("修正は正規化列も変わる。誤登録の行の削除で deleted_at が入り、選手一覧から消えるが人物は残る（代表者は 403）", async () => {
    await updateMemberByAdmin(app, as(ids.tenantAdmin), S, memberId, { name: `${tag} 華子`, kana: "はなこ", birthDate: "1995-05-05", sex: "female" });
    const [m] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, memberId)));
    expect(m).toMatchObject({ name: `${tag} 華子`, nameNormalized: normalizeName(`${tag} 華子`) });
    expect(await statusOf(() => updateMemberByAdmin(app, as(ids.captain), S, memberId, { name: "x" }))).toBe(403);

    expect(await statusOf(() => deleteTeamMemberRow(app, as(ids.captain), S, team2, teamMemberId))).toBe(403);
    await deleteTeamMemberRow(app, as(ids.tenantAdmin), S, team2, teamMemberId);
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamMembers).where(eq(teamMembers.id, teamMemberId)));
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedBy).toBe(ids.tenantAdmin);
    expect((await getRoster(app, as(ids.captain), S, team2)).items).toHaveLength(0);
    expect((await getMemberForAdmin(app, as(ids.tenantAdmin), S, memberId)).teams).toHaveLength(0);
    expect(await statusOf(() => deleteTeamMemberRow(app, as(ids.tenantAdmin), S, team2, teamMemberId))).toBe(404);
    // 人物は残り、もう一度加えると同じ人物に結びつく
    const again = await addPlayer(app, as(ids.captain), S, team2, { name: `${tag} 華子`, kana: "", birthDate: "1995-05-05", sex: "female" });
    expect(again).toMatchObject({ memberId, created: false });
  });
});
