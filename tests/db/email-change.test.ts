import { eq, inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { loginCodes, mailLogs, rateLimits, sessions, users } from "@/db/schema";
import { confirmEmailChange, requestEmailChange } from "@/lib/account/email-change";
import { hashEmailForKey } from "@/lib/auth/login-code";
import { createSession, loadSession } from "@/lib/auth/session";
import { composeMail } from "@/lib/mail/templates";
import type { MailSender, OutgoingMail } from "@/lib/mail/types";

// メールアドレスの変更（設計書 §5.19・§9.2 の受け入れ条件）
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const tag = random();
const IP = `10.3.0.${Math.floor(Math.random() * 250)}`;
const T0 = new Date("2026-05-01T00:00:00Z");
const usedEmails: string[] = [];
const mail = (name: string) => {
  const email = `email-change-${tag}-${name}@example.com`;
  if (!usedEmails.includes(email)) usedEmails.push(email);
  return email;
};
const CTX = { associationName: null, associationSlug: null, baseUrl: "https://example.test" };

// 確認番号は保存されないので、メールの件名から取り出す
async function request(userId: string, newEmail: string, attemptId?: string, now: Date = T0) {
  const sent: OutgoingMail[] = [];
  const sender: MailSender = {
    async send(m) {
      sent.push(m);
      return {};
    },
  };
  const result = await requestEmailChange(app, sender, { userId, newEmail, ip: IP, attemptId, now });
  return { result, sent, code: sent[0]?.subject.match(/(\d{6})$/)?.[1] ?? "" };
}

async function createUser(name: string): Promise<{ id: string; email: string }> {
  const email = mail(name);
  const [row] = await owner.insert(users).values({ email, emailVerifiedAt: T0 }).returning({ id: users.id });
  return { id: row.id, email };
}

afterAll(async () => {
  const rows = await owner.select({ id: users.id }).from(users).where(like(users.email, `%${tag}%`));
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await owner.delete(sessions).where(inArray(sessions.userId, ids));
    await owner.delete(loginCodes).where(inArray(loginCodes.userId, ids));
    await owner.delete(mailLogs).where(inArray(mailLogs.userId, ids));
    await owner.delete(users).where(inArray(users.id, ids));
  }
  await owner.delete(mailLogs).where(like(mailLogs.toEmail, `%${tag}%`));
  await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:ip:${IP}`));
  await owner.delete(rateLimits).where(eq(rateLimits.key, `login_verify:ip:${IP}`));
  await owner.delete(rateLimits).where(eq(rateLimits.key, "login_request:all"));
  for (const email of usedEmails) {
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_request:email:${hashEmailForKey(email)}`));
    await owner.delete(rateLimits).where(eq(rateLimits.key, `login_verify:email:${hashEmailForKey(email)}`));
  }
  await closeDb(app);
  await closeDb(owner);
});

describe("メールアドレスの変更", () => {
  it("新しいアドレスの確認番号で変わり、古いアドレスに知らせが積まれ、ほかのセッションは終わる", async () => {
    const me = await createUser("taro");
    const newEmail = mail("taro-new");
    const here = await createSession(app, me.id, T0);
    const other = await createSession(app, me.id, T0);

    const { result, sent, code } = await request(me.id, newEmail);
    expect(result.kind).toBe("sent");
    // 番号は新しいアドレスにだけ届く（件名に番号・§9.2）
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(newEmail);
    expect(sent[0].subject).toMatch(/確認番号 \d{6}$/);
    expect(sent[0].text).toContain("メールアドレスの変更");
    if (result.kind !== "sent") throw new Error("発行できていません");

    // 番号を入れるまでは変わらない
    expect((await owner.select().from(users).where(eq(users.id, me.id)))[0].email).toBe(me.email);

    const confirmed = await confirmEmailChange(app, {
      userId: me.id,
      attemptId: result.attemptId,
      code,
      ip: IP,
      sessionId: here.id,
      now: T0,
    });
    expect(confirmed).toMatchObject({ ok: true, email: newEmail, endedSessions: 1 });

    const [after] = await owner.select().from(users).where(eq(users.id, me.id));
    expect(after.email).toBe(newEmail);
    expect(after.emailVerifiedAt?.getTime()).toBe(T0.getTime());

    // いま操作している端末は残り、ほかの端末は終わる
    expect(await loadSession(app, here.id, T0)).not.toBeNull();
    expect(await loadSession(app, other.id, T0)).toBeNull();

    // 古いアドレスに知らせ（新しいアドレスは本文に書かない）
    const queued = await owner.select().from(mailLogs).where(eq(mailLogs.toEmail, me.email));
    expect(queued.map((m) => m.mailType)).toEqual(["email_changed"]);
    const composed = await composeMail("email_changed", {}, CTX, owner);
    expect(composed.subject).toContain("メールアドレスを変更しました");
    expect(composed.text).toContain("https://example.test/contact");
    expect(composed.text).not.toContain(newEmail);

    // 同じ番号は 2 回使えない
    const again = await confirmEmailChange(app, {
      userId: me.id,
      attemptId: result.attemptId,
      code,
      ip: IP,
      sessionId: here.id,
      now: T0,
    });
    expect(again).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("別のアカウントで使われているアドレスには変えない（番号を入れたあとに知らせる）", async () => {
    const me = await createUser("jiro");
    const other = await createUser("hanako");
    const session = await createSession(app, me.id, T0);

    const { result, code } = await request(me.id, other.email);
    if (result.kind !== "sent") throw new Error("発行できていません");
    const confirmed = await confirmEmailChange(app, {
      userId: me.id,
      attemptId: result.attemptId,
      code,
      ip: IP,
      sessionId: session.id,
      now: T0,
    });
    expect(confirmed).toMatchObject({ ok: false, reason: "taken" });
    expect((await owner.select().from(users).where(eq(users.id, me.id)))[0].email).toBe(me.email);
    // 知らせも積まない
    expect(await owner.select().from(mailLogs).where(eq(mailLogs.toEmail, me.email))).toHaveLength(0);
  });

  it("いまと同じアドレス・形が違うアドレスは 400。ほかの人の番号では変わらない", async () => {
    const me = await createUser("saburo");
    const stranger = await createUser("taro2");
    const session = await createSession(app, me.id, T0);

    expect(await request(me.id, me.email).then((r) => r.result)).toMatchObject({ kind: "invalid" });
    expect(await request(me.id, "こわれた").then((r) => r.result)).toMatchObject({ kind: "invalid" });

    // 別の人が発行した番号では、この人のアドレスは変わらない（userId で絞る）
    const { result, code } = await request(stranger.id, mail("saburo-new"));
    if (result.kind !== "sent") throw new Error("発行できていません");
    const confirmed = await confirmEmailChange(app, {
      userId: me.id,
      attemptId: result.attemptId,
      code,
      ip: IP,
      sessionId: session.id,
      now: T0,
    });
    expect(confirmed).toMatchObject({ ok: false, reason: "invalid" });
    expect((await owner.select().from(users).where(eq(users.id, me.id)))[0].email).toBe(me.email);
  });

  it("番号を間違えると残り回数が減り、5 回でその試行の番号が無効になる", async () => {
    const me = await createUser("shiro");
    const session = await createSession(app, me.id, T0);
    const { result, code } = await request(me.id, mail("shiro-new"));
    if (result.kind !== "sent") throw new Error("発行できていません");

    const wrong = (n: number) =>
      confirmEmailChange(app, { userId: me.id, attemptId: result.attemptId, code: `00000${n}`, ip: IP, sessionId: session.id, now: T0 });
    expect(await wrong(1)).toMatchObject({ ok: false, reason: "invalid", remaining: 4 });
    expect(await wrong(2)).toMatchObject({ ok: false, reason: "invalid", remaining: 3 });
    expect(await wrong(3)).toMatchObject({ ok: false, reason: "invalid", remaining: 2 });
    expect(await wrong(4)).toMatchObject({ ok: false, reason: "invalid", remaining: 1 });
    expect(await wrong(5)).toMatchObject({ ok: false, reason: "invalid", remaining: 0 });
    // 上限を超えたので、正しい番号でも通らない
    expect(
      await confirmEmailChange(app, { userId: me.id, attemptId: result.attemptId, code, ip: IP, sessionId: session.id, now: T0 }),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });
});
