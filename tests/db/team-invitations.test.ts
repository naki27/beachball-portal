import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, mailLogs, members, teamInvitations, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { InvitationError } from "@/lib/invitations/admin-accept";
import { acceptTeamInvitation, rejectTeamInvitation } from "@/lib/invitations/team-respond";
import { composeMail } from "@/lib/mail/templates";
import { normalizeName } from "@/lib/normalize";
import { listMyPendingInvitations } from "@/lib/repo/invitations";
import { TeamError } from "@/lib/teams/errors";
import { cancelTeamInvitation, invitePlayer, resendTeamInvitation, TEAM_INVITATION_DAYS } from "@/lib/teams/invitations";
import { addPlayer, getRoster } from "@/lib/teams/roster";
import { registerIndividual, unlinkMember } from "@/lib/teams/self";
import { registerTeam } from "@/lib/teams/teams";

// 選手の招待（設計書 §5.15）: 招待・再送・取り消し、返事待ちを重ねない、承諾の前提の再検査、拒否の知らせ、紐づけの解除
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const S = SAWARA_ASSOCIATION_ID;
const tag = `招待${random()}`;
const NOW = new Date();
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const ids = { adminA: "", adminB: "", taro: "", hanako: "", other: "", tenantAdmin: "" };
const emails: Record<keyof typeof ids, string> = { adminA: "", adminB: "", taro: "", hanako: "", other: "", tenantAdmin: "" };
let teamX = "";
let teamY = "";
let taroMember = "";
let taroTmX = "";

const person = (name: string, extra: Record<string, unknown> = {}) => ({ name: `${tag} ${name}`, kana: "", birthDate: "1992-02-02", sex: "male", ...extra });

async function statusOf(run: () => Promise<unknown>): Promise<number | "ok"> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError || error instanceof InvitationError) return error.status;
    throw error;
  }
}

async function queuedMails(toEmail: string) {
  return owner.select().from(mailLogs).where(and(eq(mailLogs.toEmail, toEmail), eq(mailLogs.status, "queued")));
}

beforeAll(async () => {
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    emails[key] = `team-inv-${key}-${random()}@example.com`;
    const [u] = await owner.insert(users).values({ email: emails[key], emailVerifiedAt: NOW, displayName: key === "adminA" ? "代表 A" : null }).returning({ id: users.id });
    ids[key] = u.id;
  }
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: ids.tenantAdmin }));
  const base = { kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false };
  teamX = (await registerTeam(app, S, ids.adminA, { ...base, name: `${tag} X` })).id;
  teamY = (await registerTeam(app, S, ids.adminB, { ...base, name: `${tag} Y` })).id;
  const added = await addPlayer(app, as(ids.adminA), S, teamX, person("太郎"));
  taroMember = added.memberId;
  taroTmX = added.teamMemberId;
  await addPlayer(app, as(ids.adminA), S, teamX, person("次郎", { birthDate: "1993-03-03" }));
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

describe("招待・再送・取り消し（代表者）", () => {
  let invitationId = "";

  it("招待すると 3 日の返事待ちの行ができ、本人宛てのメールが送信待ちに積まれる（本文に協会・チーム・アドレス・期限、リンクなし）", async () => {
    const result = await invitePlayer(app, as(ids.adminA), S, teamX, { memberId: taroMember, email: emails.taro.toUpperCase() }, NOW);
    invitationId = result.invitationId;
    expect(result.resent).toBe(false);
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.id, invitationId)));
    expect(row).toMatchObject({ kind: "player", memberId: taroMember, email: emails.taro, status: "pending", invitedBy: ids.adminA });
    expect(row.expiresAt.getTime() - NOW.getTime()).toBe(TEAM_INVITATION_DAYS * 24 * 60 * 60 * 1000);
    const mails = await queuedMails(emails.taro);
    expect(mails.map((m) => m.mailType)).toEqual(["team_invitation"]);
    const composed = await withTenantOn(owner, S, (tx) =>
      composeMail("team_invitation", { invitationId }, { associationName: "早良区協会", associationSlug: "sawara", baseUrl: "https://example.test" }, tx),
    );
    expect(composed.subject).toBe(`【早良区協会】${tag} Xからの招待`);
    expect(composed.text).toContain(`${tag} X の代表者の 代表 A さんから、選手（${tag} 太郎）として招待されました`);
    expect(composed.text).toContain(`（${emails.taro}）でログイン`);
    expect(composed.text).toContain("https://example.test/sawara/");
    expect(composed.text).toMatch(/期限: \d+月\d+日（[日月火水木金土]）まで/);
    expect(composed.text).not.toMatch(/\/login/);
    // 選手一覧には「招待中」として出る（代表者だけ）
    const roster = await getRoster(app, as(ids.adminA), S, teamX);
    expect(roster.items.find((i) => i.memberId === taroMember)?.account).toMatchObject({ linked: false, invitation: { invitationId, email: emails.taro, expired: false } });
  });

  it("同じチームから同じ人へは同じ行を再送する（返事待ちを重ねない）。別のチームからは 409", async () => {
    await addPlayer(app, as(ids.adminB), S, teamY, person("太郎"));
    const again = await invitePlayer(app, as(ids.adminA), S, teamX, { memberId: taroMember, email: emails.taro }, NOW);
    expect(again).toMatchObject({ invitationId, resent: true });
    expect(await statusOf(() => invitePlayer(app, as(ids.adminB), S, teamY, { memberId: taroMember, email: emails.taro }, NOW))).toBe(409);
    const resent = await resendTeamInvitation(app, as(ids.adminA), S, teamX, invitationId, new Date(NOW.getTime() + 1000));
    expect(resent.invitationId).toBe(invitationId);
    expect((await queuedMails(emails.taro)).length).toBe(3);
  });

  it("代表者でない人は 403。選手一覧にいない人物・形の違うアドレスは 404 / 400", async () => {
    expect(await statusOf(() => invitePlayer(app, as(ids.other), S, teamX, { memberId: taroMember, email: emails.taro }))).toBe(403);
    expect(await statusOf(() => invitePlayer(app, as(ids.adminA), S, teamX, { memberId: crypto.randomUUID(), email: emails.taro }))).toBe(404);
    expect(await statusOf(() => invitePlayer(app, as(ids.adminA), S, teamX, { memberId: taroMember, email: "taro" }))).toBe(400);
  });

  it("本人の /invitations に「◯◯チームから選手（氏名）として」の形で出る。別のアドレスの人には出ない", async () => {
    const mine = await listMyPendingInvitations(app, ids.taro);
    expect(mine.find((i) => i.invitationId === invitationId)).toMatchObject({ kind: "player", teamId: teamX, teamName: `${tag} X`, memberName: `${tag} 太郎`, inviterName: "代表 A" });
    expect((await listMyPendingInvitations(app, ids.other)).map((i) => i.invitationId)).not.toContain(invitationId);
    expect(await statusOf(() => acceptTeamInvitation(app, ids.other, invitationId, NOW))).toBe(404);
  });

  it("取り消すと cancelled になり、本人に出なくなる。取り消し済みは再送できない", async () => {
    await cancelTeamInvitation(app, as(ids.adminA), S, teamX, invitationId, NOW);
    expect((await listMyPendingInvitations(app, ids.taro)).map((i) => i.invitationId)).not.toContain(invitationId);
    expect(await statusOf(() => resendTeamInvitation(app, as(ids.adminA), S, teamX, invitationId))).toBe(409);
  });
});

describe("承諾・拒否（本人）", () => {
  it("承諾すると members.user_id が入り、招待した代表者に知らせる。以後は現役の選手一覧にいるチームだけ見られる", async () => {
    const { invitationId } = await invitePlayer(app, as(ids.adminA), S, teamX, { memberId: taroMember, email: emails.taro }, NOW);
    const result = await acceptTeamInvitation(app, ids.taro, invitationId, NOW);
    expect(result.redirectTo).toBe(`/sawara/teams/${teamX}/members`);
    const [m] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, taroMember)));
    expect(m.userId).toBe(ids.taro);
    expect((await queuedMails(emails.adminA)).map((x) => x.mailType)).toContain("team_invitation_accepted");

    // 選手として X を見られ、ほかの人の生年月日は見えない。Y（太郎も載っているが現役）も見られる。承諾済みは 409
    const roster = await getRoster(app, as(ids.taro), S, teamX);
    expect(roster.canManage).toBe(false);
    expect(roster.items.find((i) => i.isSelf)?.personal?.birthDate).toBe("1992-02-02");
    expect(roster.items.filter((i) => !i.isSelf).every((i) => i.personal === null && i.account === null)).toBe(true);
    expect(await statusOf(() => getRoster(app, as(ids.taro), S, teamY))).toBe("ok");
    expect(await statusOf(() => acceptTeamInvitation(app, ids.taro, invitationId, NOW))).toBe(404);
    expect((await getRoster(app, as(ids.adminA), S, teamX)).items.find((i) => i.memberId === taroMember)?.account).toMatchObject({ linked: true, invitation: null });

    // 紐づいた人にはもう招待できない
    expect(await statusOf(() => invitePlayer(app, as(ids.adminA), S, teamX, { memberId: taroMember, email: emails.taro }))).toBe(409);
  });

  it("期限切れは承諾できない（409）", async () => {
    const jiro = (await getRoster(app, as(ids.adminA), S, teamX)).items.find((i) => i.name === `${tag} 次郎`)!;
    const { invitationId } = await invitePlayer(app, as(ids.adminA), S, teamX, { memberId: jiro.memberId, email: emails.hanako }, NOW);
    const later = new Date(NOW.getTime() + (TEAM_INVITATION_DAYS * 24 + 1) * 60 * 60 * 1000);
    expect(await statusOf(() => acceptTeamInvitation(app, ids.hanako, invitationId, later))).toBe(409);
    // 再送すると期限が延び、承諾できる → ただし花子は次の試験で別の人物に紐づくので、ここでは拒否する
    await resendTeamInvitation(app, as(ids.adminA), S, teamX, invitationId, later);
    await rejectTeamInvitation(app, ids.hanako, invitationId, later);
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.id, invitationId)));
    expect(row.status).toBe("rejected");
    expect((await queuedMails(emails.adminA)).map((x) => x.mailType)).toContain("team_invitation_rejected");
  });

  it("同じ協会で別の人物にすでに紐づいたアカウントは承諾できず、招待の人物は要確認になる（招待は返事待ちのまま）", async () => {
    // 花子は自分で個人登録している（= 別の人物に紐づいている）
    await registerIndividual(app, as(ids.hanako), S, person("花子", { sex: "female" }));
    const jiro = (await getRoster(app, as(ids.adminA), S, teamX)).items.find((i) => i.name === `${tag} 次郎`)!;
    const { invitationId } = await invitePlayer(app, as(ids.adminA), S, teamX, { memberId: jiro.memberId, email: emails.hanako }, NOW);
    const error = (await acceptTeamInvitation(app, ids.hanako, invitationId, NOW).catch((e: unknown) => e)) as InvitationError;
    expect(error).toBeInstanceOf(InvitationError);
    expect(error.message).toContain(`すでに別の登録（${tag} 花子`);
    const [m] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, jiro.memberId)));
    expect(m).toMatchObject({ status: "needs_review", userId: null });
    const [row] = await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.id, invitationId)));
    expect(row.status).toBe("pending");
  });
});

describe("紐づけの解除（本人・テナント管理者）", () => {
  it("代表者は解除できない（403）。本人は解除でき、選手として見られなくなる。テナント管理者も解除できる", async () => {
    expect(await statusOf(() => unlinkMember(app, as(ids.adminA), S, taroMember))).toBe(403);
    await unlinkMember(app, as(ids.taro), S, taroMember);
    expect(await statusOf(() => getRoster(app, as(ids.taro), S, teamX))).toBe(403);
    expect(await statusOf(() => unlinkMember(app, as(ids.tenantAdmin), S, taroMember))).toBe(409); // もう紐づいていない
    // もう一度紐づけて、テナント管理者が解除
    await withTenantOn(owner, S, (tx) => tx.update(members).set({ userId: ids.taro }).where(eq(members.id, taroMember)));
    await unlinkMember(app, as(ids.tenantAdmin), S, taroMember);
    const [m] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, taroMember)));
    expect(m.userId).toBeNull();
    expect(taroTmX).toBeTruthy();
  });

  it("個人登録がある間は本人からは解除できない（409）", async () => {
    const hanako = (await withTenantOn(owner, S, (tx) => tx.select().from(members).where(and(eq(members.associationId, S), eq(members.userId, ids.hanako)))))[0];
    expect(await statusOf(() => unlinkMember(app, as(ids.hanako), S, hanako.id))).toBe(409);
  });
});
