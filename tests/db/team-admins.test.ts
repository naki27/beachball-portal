import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, mailLogs, members, teamAdmins, teamInvitations, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { InvitationError } from "@/lib/invitations/admin-accept";
import { acceptTeamInvitation } from "@/lib/invitations/team-respond";
import { normalizeName } from "@/lib/normalize";
import { listMyPendingInvitations } from "@/lib/repo/invitations";
import { getTeamAdmins, inviteAdmin, revokeTeamAdmin } from "@/lib/teams/admins";
import { TeamError } from "@/lib/teams/errors";
import { invitePlayer } from "@/lib/teams/invitations";
import { addPlayer, getRoster } from "@/lib/teams/roster";
import { registerTeam, setTeamStatus } from "@/lib/teams/teams";

// 代表者の委譲・解除とチームの無効化（設計書 §5.11）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const S = SAWARA_ASSOCIATION_ID;
const tag = `代表${random()}`;
const NOW = new Date();
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const ids = { a: "", b: "", c: "", tenantAdmin: "" };
const emails = { a: "", b: "", c: "", tenantAdmin: "" };
let teamId = "";

async function statusOf(run: () => Promise<unknown>): Promise<number | "ok"> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError || error instanceof InvitationError) return error.status;
    throw error;
  }
}

beforeAll(async () => {
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    emails[key] = `team-admin-${key}-${random()}@example.com`;
    const [u] = await owner.insert(users).values({ email: emails[key], emailVerifiedAt: NOW }).returning({ id: users.id });
    ids[key] = u.id;
  }
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: ids.tenantAdmin }));
  teamId = (await registerTeam(app, S, ids.a, { name: `${tag} チーム`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(teams).where(inArray(teams.createdBy, Object.values(ids)));
    await tx.delete(members).where(and(eq(members.associationId, S), like(members.nameNormalized, `${normalizeName(tag)}%`)));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, ids.tenantAdmin));
  });
  await owner.delete(mailLogs).where(inArray(mailLogs.toEmail, Object.values(emails)));
  await owner.delete(users).where(inArray(users.id, Object.values(ids)));
  await closeDb(owner);
  await closeDb(app);
});

describe("代表者の委譲（招待 → 承諾）と解除", () => {
  it("最後の 1 人は降りられない（409）", async () => {
    expect(await statusOf(() => revokeTeamAdmin(app, as(ids.a), S, teamId, ids.a))).toBe(409);
  });

  it("メールアドレスで代表者として招待し、本人が承諾すると team_admins に granted_by 付きで入る。同じアドレスは同じ行を再送", async () => {
    const first = await inviteAdmin(app, as(ids.a), S, teamId, { email: emails.b.toUpperCase() }, NOW);
    expect(first.resent).toBe(false);
    const again = await inviteAdmin(app, as(ids.a), S, teamId, { email: emails.b }, NOW);
    expect(again).toMatchObject({ invitationId: first.invitationId, resent: true });
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.id, first.invitationId)));
    expect(row).toMatchObject({ kind: "admin", memberId: null, email: emails.b, status: "pending" });
    expect((await getTeamAdmins(app, as(ids.a), S, teamId)).invitations.map((i) => i.invitationId)).toEqual([first.invitationId]);

    const mine = await listMyPendingInvitations(app, ids.b);
    expect(mine.find((i) => i.invitationId === first.invitationId)).toMatchObject({ kind: "admin", teamId, memberName: null });
    const result = await acceptTeamInvitation(app, ids.b, first.invitationId, NOW);
    expect(result.redirectTo).toBe(`/sawara/teams/${teamId}`);
    const [admin] = await withTenantOn(owner, S, (tx) => tx.select().from(teamAdmins).where(and(eq(teamAdmins.teamId, teamId), eq(teamAdmins.userId, ids.b))));
    expect(admin).toMatchObject({ grantedBy: ids.a, revokedAt: null });
    expect((await getTeamAdmins(app, as(ids.b), S, teamId)).admins.map((a) => a.userId).sort()).toEqual([ids.a, ids.b].sort());
    // すでに代表者の人はもう招待できない
    expect(await statusOf(() => inviteAdmin(app, as(ids.a), S, teamId, { email: emails.b }))).toBe(409);
  });

  it("選手として紐づいている人を選んで招待できる（その人のログインのアドレスに送る）。紐づいていない人は 409", async () => {
    const cMember = await addPlayer(app, as(ids.a), S, teamId, { name: `${tag} 三郎`, kana: "", birthDate: "1991-01-01", sex: "male" });
    expect(await statusOf(() => inviteAdmin(app, as(ids.a), S, teamId, { memberId: cMember.memberId }))).toBe(409);
    await withTenantOn(owner, S, (tx) => tx.update(members).set({ userId: ids.c }).where(eq(members.id, cMember.memberId)));
    expect((await getTeamAdmins(app, as(ids.a), S, teamId)).candidates).toEqual([{ memberId: cMember.memberId, name: `${tag} 三郎` }]);
    const inv = await inviteAdmin(app, as(ids.a), S, teamId, { memberId: cMember.memberId }, NOW);
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.id, inv.invitationId)));
    expect(row.email).toBe(emails.c);
    // 代表者でない人（c）は招待も解除もできない
    expect(await statusOf(() => inviteAdmin(app, as(ids.c), S, teamId, { email: "x@example.com" }))).toBe(403);
    expect(await statusOf(() => revokeTeamAdmin(app, as(ids.c), S, teamId, ids.a))).toBe(403);
  });

  it("2 人いれば元の代表者は降りられ、残った代表者は降りられない", async () => {
    await revokeTeamAdmin(app, as(ids.a), S, teamId, ids.a, NOW);
    expect(await statusOf(() => getTeamAdmins(app, as(ids.a), S, teamId))).toBe(403);
    expect((await getTeamAdmins(app, as(ids.b), S, teamId)).admins.map((a) => a.userId)).toEqual([ids.b]);
    expect(await statusOf(() => revokeTeamAdmin(app, as(ids.b), S, teamId, ids.b))).toBe(409);
    // テナント管理者も最後の 1 人は外せない
    expect(await statusOf(() => revokeTeamAdmin(app, as(ids.tenantAdmin), S, teamId, ids.b))).toBe(409);
  });
});

describe("無効化と有効に戻す", () => {
  it("無効化すると返事待ちの招待が取り消され、招待・承諾ができなくなる。代表者の行は残る。有効に戻せる", async () => {
    const jiro = await addPlayer(app, as(ids.b), S, teamId, { name: `${tag} 次郎`, kana: "", birthDate: "1992-02-02", sex: "male" });
    const playerInv = await invitePlayer(app, as(ids.b), S, teamId, { memberId: jiro.memberId, email: `team-admin-x-${random()}@example.com` }, NOW);
    const result = await setTeamStatus(app, as(ids.b), S, teamId, "inactive", NOW);
    expect(result.cancelledInvitations).toBeGreaterThanOrEqual(2); // 三郎への代表者の招待と次郎への選手の招待
    const rows = await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.teamId, teamId)));
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(0);
    expect(rows.find((r) => r.id === playerInv.invitationId)?.status).toBe("cancelled");
    expect((await getRoster(app, as(ids.b), S, teamId)).team.status).toBe("inactive");
    expect(await statusOf(() => invitePlayer(app, as(ids.b), S, teamId, { memberId: jiro.memberId, email: "y@example.com" }))).toBe(409);
    expect(await statusOf(() => inviteAdmin(app, as(ids.b), S, teamId, { email: "y@example.com" }))).toBe(409);
    expect((await getTeamAdmins(app, as(ids.b), S, teamId)).admins.map((a) => a.userId)).toEqual([ids.b]);

    await setTeamStatus(app, as(ids.b), S, teamId, "active", NOW);
    expect((await getRoster(app, as(ids.b), S, teamId)).team.status).toBe("active");
  });

  it("代表者でない人は 403。テナント管理者は無効化できる", async () => {
    expect(await statusOf(() => setTeamStatus(app, as(ids.c), S, teamId, "inactive"))).toBe(403);
    expect(await statusOf(() => setTeamStatus(app, as(ids.tenantAdmin), S, teamId, "inactive"))).toBe("ok");
    await setTeamStatus(app, as(ids.tenantAdmin), S, teamId, "active");
  });
});
