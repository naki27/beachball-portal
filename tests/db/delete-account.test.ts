import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associationAdmins,
  loginCodes,
  mailLogs,
  members,
  rateLimits,
  sessions,
  teamInvitations,
  teams,
  users,
} from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { accountDeletionBlock, deleteMyAccount } from "@/lib/account/delete-account";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { hashEmailForKey } from "@/lib/auth/login-code";
import { requestLoginCode } from "@/lib/auth/request-login-code";
import { createSession, loadSession } from "@/lib/auth/session";
import { verifyLoginCode } from "@/lib/auth/verify-login-code";
import type { MailSender, OutgoingMail } from "@/lib/mail/types";
import { normalizeName } from "@/lib/normalize";
import { addPlayer } from "@/lib/teams/roster";
import { invitePlayer } from "@/lib/teams/invitations";
import { registerTeam } from "@/lib/teams/teams";

// アカウントの削除（設計書 §5.19 の受け入れ条件）
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const tag = random();
const S = SAWARA_ASSOCIATION_ID;
const IP = `10.4.0.${Math.floor(Math.random() * 250)}`;
const T0 = new Date("2026-05-01T00:00:00Z");
const TERMS = "2027-01-31";
const usedEmails: string[] = [];
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const mail = (name: string) => {
  const email = `delete-acct-${tag}-${name}@example.com`;
  if (!usedEmails.includes(email)) usedEmails.push(email);
  return email;
};

const createdIds: string[] = [];

async function createUser(name: string): Promise<{ id: string; email: string }> {
  const email = mail(name);
  const [row] = await owner.insert(users).values({ email, emailVerifiedAt: T0 }).returning({ id: users.id });
  createdIds.push(row.id);
  return { id: row.id, email };
}

// いまのアドレス宛てに確認番号を出す（削除の確認に使う・§5.19）
async function issueCode(email: string, now: Date = T0): Promise<{ attemptId: string; code: string }> {
  const sent: OutgoingMail[] = [];
  const sender: MailSender = {
    async send(m) {
      sent.push(m);
      return {};
    },
  };
  const result = await requestLoginCode(app, sender, { email, ip: IP, associationName: null, now });
  if (result.kind !== "sent") throw new Error("発行できていません");
  return { attemptId: result.attemptId, code: sent[0].subject.match(/(\d{6})$/)![1] };
}

afterAll(async () => {
  // 削除した行はメールアドレスが置き換わるので、作ったときの ID で消す
  const ids = createdIds;
  if (ids.length > 0) {
    await withTenantOn(owner, S, async (tx) => {
      await tx.delete(teamInvitations).where(inArray(teamInvitations.invitedBy, ids));
      await tx.delete(teams).where(inArray(teams.createdBy, ids));
      await tx.delete(members).where(like(members.nameNormalized, `${normalizeName(tag)}%`));
    });
    await owner.delete(associationAdmins).where(inArray(associationAdmins.userId, ids));
    await owner.delete(sessions).where(inArray(sessions.userId, ids));
    await owner.delete(loginCodes).where(inArray(loginCodes.userId, ids));
  }
  await owner.delete(mailLogs).where(like(mailLogs.toEmail, `%${tag}%`));
  for (const email of usedEmails) {
    await owner.delete(loginCodes).where(eq(loginCodes.email, email));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:email:${hashEmailForKey(email)}`));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_verify:email:${hashEmailForKey(email)}`));
  }
  // 作り直したアカウント（同じアドレスで入り直したもの）も消す
  const remade = await owner.select({ id: users.id }).from(users).where(like(users.email, `%${tag}%`));
  const all = [...new Set([...ids, ...remade.map((r) => r.id)])];
  if (all.length > 0) {
    await owner.delete(sessions).where(inArray(sessions.userId, all));
    await owner.delete(users).where(inArray(users.id, all));
  }
  await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:ip:${IP}`));
  await owner.delete(rateLimits).where(eq(rateLimits.key, `login_verify:ip:${IP}`));
  await owner.delete(rateLimits).where(eq(rateLimits.key, "login_request:all"));
  await closeDb(app);
  await closeDb(owner);
});

describe("アカウントの削除", () => {
  it("チームのないアカウントは削除でき、同じアドレスで作り直せる", async () => {
    const me = await createUser("taro");
    const session = await createSession(app, me.id, T0);
    expect(await accountDeletionBlock(app, me.id)).toBeNull();

    const { attemptId, code } = await issueCode(me.email);
    const result = await deleteMyAccount(app, { userId: me.id, attemptId, code, ip: IP, now: T0 });
    expect(result).toMatchObject({ ok: true });

    const [after] = await owner.select().from(users).where(eq(users.id, me.id));
    expect(after.deletedAt).not.toBeNull();
    expect(after.deletedBy).toBe(me.id);
    expect(after.displayName).toBeNull();
    expect(after.emailVerifiedAt).toBeNull();
    // 元のメールアドレスはどこにも残らない
    expect(after.email).not.toBe(me.email);
    expect(after.email).toMatch(/^deleted-.*@deleted\.invalid$/);
    // セッションは全部終わる
    expect(await loadSession(app, session.id, T0)).toBeNull();

    // 同じアドレスで新しいアカウントを作れる（前の登録とはつながらない）
    const again = await issueCode(me.email);
    const login = await verifyLoginCode(app, { attemptId: again.attemptId, code: again.code, ip: IP, termsVersion: TERMS, now: T0 });
    expect(login).toMatchObject({ ok: true, isNewUser: true });
    if (!login.ok) throw new Error("ログインできていません");
    expect(login.userId).not.toBe(me.id);
  });

  it("代表者を務めるチームがあると削除できない。降りれば削除できる", async () => {
    const me = await createUser("hanako");
    const { attemptId, code } = await issueCode(me.email);
    const team = await registerTeam(app, S, me.id, {
      name: `${tag} チーム`,
      kana: null,
      contactEmail: null,
      contactPhone: null,
      membershipRenewalTarget: false,
    });

    expect(await accountDeletionBlock(app, me.id)).toBe("team_admin");
    const blocked = await deleteMyAccount(app, { userId: me.id, attemptId, code, ip: IP, now: T0 });
    expect(blocked).toMatchObject({ ok: false, reason: "blocked", blockedBy: "team_admin" });
    // 何も変えない
    expect((await owner.select().from(users).where(eq(users.id, me.id)))[0].deletedAt).toBeNull();

    // チームを消して（テナント管理者の操作の代わり）代表者でなくなれば削除できる
    await withTenantOn(owner, S, (tx) => tx.update(teams).set({ deletedAt: T0 }).where(eq(teams.id, team.id)));
    expect(await accountDeletionBlock(app, me.id)).toBeNull();
    const second = await issueCode(me.email);
    expect(await deleteMyAccount(app, { userId: me.id, attemptId: second.attemptId, code: second.code, ip: IP, now: T0 })).toMatchObject({ ok: true });
  });

  it("協会の管理者は削除できない", async () => {
    const me = await createUser("kanri");
    await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: me.id }));
    expect(await accountDeletionBlock(app, me.id)).toBe("association_admin");
    const { attemptId, code } = await issueCode(me.email);
    expect(await deleteMyAccount(app, { userId: me.id, attemptId, code, ip: IP, now: T0 })).toMatchObject({
      ok: false,
      reason: "blocked",
      blockedBy: "association_admin",
    });
  });

  it("人物との紐づけは外れ、返事待ちの招待は取り消される（人物と申し込みは残る）", async () => {
    const captain = await createUser("captain");
    const player = await createUser("player");
    const team = await registerTeam(app, S, captain.id, {
      name: `${tag} 招待チーム`,
      kana: null,
      contactEmail: null,
      contactPhone: null,
      membershipRenewalTarget: false,
    });
    // ① この人のアドレス宛ての、返事待ちの招待
    const mine = await addPlayer(app, as(captain.id), S, team.id, {
      name: `${tag} 選手`,
      kana: "",
      birthDate: "1990-05-03",
      sex: "male",
    });
    const toMe = await invitePlayer(app, as(captain.id), S, team.id, { memberId: mine.memberId, email: player.email }, T0);
    // ② この人のアカウントに紐づいた人物
    const linked = await addPlayer(app, as(captain.id), S, team.id, {
      name: `${tag} 本人`,
      kana: "",
      birthDate: "1988-01-02",
      sex: "male",
    });
    await withTenantOn(owner, S, (tx) => tx.update(members).set({ userId: player.id }).where(eq(members.id, linked.memberId)));
    // ③ 代表者が別の人に送った、返事待ちの招待
    const other = await addPlayer(app, as(captain.id), S, team.id, {
      name: `${tag} 別の人`,
      kana: "",
      birthDate: "1992-03-04",
      sex: "female",
    });
    const toOther = await invitePlayer(app, as(captain.id), S, team.id, { memberId: other.memberId, email: mail("invitee") }, T0);

    const { attemptId, code } = await issueCode(player.email);
    const result = await deleteMyAccount(app, { userId: player.id, attemptId, code, ip: IP, now: T0 });
    expect(result).toMatchObject({ ok: true, unlinkedMembers: 1, cancelledInvitations: 1 });

    // 人物は残り、アカウントとの紐づけだけ外れる
    const [person] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, linked.memberId)));
    expect(person.deletedAt).toBeNull();
    expect(person.userId).toBeNull();

    const statusOf = async (invitationId: string) =>
      (await withTenantOn(owner, S, (tx) => tx.select().from(teamInvitations).where(eq(teamInvitations.id, invitationId))))[0].status;
    // 自分のアドレス宛ては取り消し。ほかの人宛ては残る
    expect(await statusOf(toMe.invitationId)).toBe("cancelled");
    expect(await statusOf(toOther.invitationId)).toBe("pending");

    // 招待を送った代表者が消えると、その人が送った返事待ちの招待も取り消される
    await withTenantOn(owner, S, (tx) => tx.update(teams).set({ deletedAt: T0 }).where(eq(teams.id, team.id)));
    const captainCode = await issueCode(captain.email);
    const captainResult = await deleteMyAccount(app, {
      userId: captain.id,
      attemptId: captainCode.attemptId,
      code: captainCode.code,
      ip: IP,
      now: T0,
    });
    expect(captainResult).toMatchObject({ ok: true, cancelledInvitations: 1 });
    expect(await statusOf(toOther.invitationId)).toBe("cancelled");
  });

  it("番号が違えば削除しない", async () => {
    const me = await createUser("jiro");
    const { attemptId } = await issueCode(me.email);
    expect(await deleteMyAccount(app, { userId: me.id, attemptId, code: "000000", ip: IP, now: T0 })).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect((await owner.select().from(users).where(eq(users.id, me.id)))[0].deletedAt).toBeNull();
  });
});
