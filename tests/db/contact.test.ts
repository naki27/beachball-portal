import { eq, inArray, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associations, contactMessages, mailLogs, platformContactMessages, rateLimits } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { listAssociationContacts, listPlatformContacts, setAssociationContactStatus, setPlatformContactStatus } from "@/lib/contact-admin";
import { CONTACT_LIMIT_PER_HOUR, submitContactMessage } from "@/lib/contact";
import { composeMail } from "@/lib/mail/templates";
import { SITE_NAME } from "@/lib/site";

// 問い合わせフォーム（設計書 §5.10）: 保存・受付控えと転送・honeypot・レート制限・一覧と対応済み化・テナントの分かれ
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const tag = random();
const S = SAWARA_ASSOCIATION_ID;
const FORWARD_TO = `sawara-contact-${tag}@example.com`;
const ctx = { associationName: "早良区協会", associationSlug: "sawara", baseUrl: "https://example.test" };
const mail = (email: string) => `contact-${tag}-${email}@example.com`;

let otherAssociationId = "";
let savedContactEmail: string | null = null;

// この試験で作った問い合わせだけを見る（早良区協会は他の試験でも使う）
async function listSawara(filter: { status?: "new" | "done" } = {}) {
  const rows = await listAssociationContacts(app, S, filter);
  return rows.filter((row) => row.senderEmail.includes(tag));
}

beforeAll(async () => {
  const [before] = await owner.select({ contactEmail: associations.contactEmail }).from(associations).where(eq(associations.id, S));
  savedContactEmail = before.contactEmail;
  // 転送先はその協会の連絡先メール（§5.10）
  await owner.update(associations).set({ contactEmail: FORWARD_TO }).where(eq(associations.id, S));
  const [other] = await owner
    .insert(associations)
    .values({ name: `問い合わせ試験協会 ${tag}`, slug: `contact-${tag}` })
    .returning({ id: associations.id });
  otherAssociationId = other.id;
});

afterAll(async () => {
  await owner.update(associations).set({ contactEmail: savedContactEmail }).where(eq(associations.id, S));
  await owner.delete(mailLogs).where(like(mailLogs.toEmail, `%${tag}%`));
  await owner.delete(mailLogs).where(eq(mailLogs.toEmail, FORWARD_TO));
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, otherAssociationId));
  for (const id of [S, otherAssociationId]) {
    await withTenantOn(owner, id, (tx) => tx.delete(contactMessages).where(like(contactMessages.senderEmail, `%${tag}%`)));
  }
  await owner.delete(platformContactMessages).where(like(platformContactMessages.senderEmail, `%${tag}%`));
  await owner.delete(associations).where(eq(associations.id, otherAssociationId));
  await owner.delete(rateLimits).where(like(rateLimits.key, "contact:%"));
  await closeDb(app);
  await closeDb(owner);
});

// 送信待ちの行を残さない（ほかの試験の送信ジョブが拾わないように）
afterEach(async () => {
  await owner.delete(mailLogs).where(like(mailLogs.toEmail, `%${tag}%`));
  await owner.delete(mailLogs).where(eq(mailLogs.toEmail, FORWARD_TO));
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, otherAssociationId));
});

describe("問い合わせの送信", () => {
  it("協会宛ては保存し、受付控えと転送を同じトランザクションで積む（本文は params に入れない）", async () => {
    const from = mail("taro");
    const result = await submitContactMessage(app, {
      type: "association",
      associationId: S,
      senderName: "問合 太郎",
      senderEmail: from,
      subjectType: "ログイン",
      body: "確認番号のメールが届きません。",
      ip: `10.1.${tag.length}.1`,
    });
    expect(result).toMatchObject({ ok: true, forwardedTo: FORWARD_TO });
    if (!result.ok) throw new Error("送信できていません");

    const [row] = await withTenantOn(owner, S, (tx) =>
      tx.select().from(contactMessages).where(eq(contactMessages.id, result.messageId)),
    );
    expect(row).toMatchObject({ associationId: S, subjectType: "ログイン", senderName: "問合 太郎", status: "new", userId: null });

    const queued = await owner.select().from(mailLogs).where(inArray(mailLogs.toEmail, [from, FORWARD_TO]));
    expect(queued.map((m) => `${m.mailType}:${m.toEmail}`).sort()).toEqual(
      [`contact_forwarded:${FORWARD_TO}`, `contact_received:${from}`].sort(),
    );
    // params に入るのは受付番号だけ（本文・氏名は入れない・§11「送り方」）
    for (const m of queued) {
      expect(m.params).toEqual({ messageId: result.messageId, scope: "association" });
      expect(m.associationId).toBe(S);
    }

    // 転送は本文と返信先を載せる。受付控えは控えとして本文を返す
    const [forwarded, received] = await withTenantOn(owner, S, async (tx) => [
      await composeMail("contact_forwarded", { messageId: result.messageId }, ctx, tx),
      await composeMail("contact_received", { messageId: result.messageId }, ctx, tx),
    ]);
    expect(forwarded.subject).toBe("【早良区協会】お問い合わせが届きました（ログインできない・メールが届かない）");
    expect(forwarded.text).toContain("確認番号のメールが届きません。");
    expect(forwarded.text).toContain(`返信先: ${from}`);
    expect(received.subject).toBe("【早良区協会】お問い合わせを受け付けました");
    expect(received.text).toContain("問合 太郎 様");
    expect(received.text).toContain("確認番号のメールが届きません。");
    expect(received.text).toContain("返信に数日かかることがあります");
  });

  it("サイトの運営者宛ては platform_contact_messages に入り、件名はサイト名になる", async () => {
    const from = mail("site");
    const result = await submitContactMessage(app, {
      type: "platform",
      senderName: "問合 花子",
      senderEmail: from,
      subjectType: "その他",
      body: "サイトのことでお尋ねします。",
      ip: `10.2.${tag.length}.1`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("送信できていません");

    const [row] = await app.select().from(platformContactMessages).where(eq(platformContactMessages.id, result.messageId));
    expect(row).toMatchObject({ subjectType: "その他", senderEmail: from, status: "new" });
    const queued = await owner.select().from(mailLogs).where(eq(mailLogs.toEmail, from));
    expect(queued.map((m) => m.mailType)).toEqual(["contact_received"]);
    expect(queued[0].associationId).toBeNull();
    expect(queued[0].params).toEqual({ messageId: result.messageId, scope: "platform" });

    const composed = await composeMail(
      "contact_received",
      { messageId: result.messageId, scope: "platform" },
      { associationName: null, associationSlug: null, baseUrl: ctx.baseUrl },
      owner,
    );
    expect(composed.subject).toBe(`【${SITE_NAME}】お問い合わせを受け付けました`);
    expect(composed.text).toContain("サイトのことでお尋ねします。");
  });

  it("宛先にない種別は 400（運営者宛てに申し込みの種別は選べない）", async () => {
    const result = await submitContactMessage(app, {
      type: "platform",
      senderName: "問合 次郎",
      senderEmail: mail("badsubject"),
      subjectType: "変更",
      body: "申し込みを変えたい。",
      ip: `10.3.${tag.length}.1`,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("ない協会宛ては 404", async () => {
    const result = await submitContactMessage(app, {
      type: "association",
      associationId: "00000000-0000-4000-8000-000000000000",
      senderName: "問合 三郎",
      senderEmail: mail("noassoc"),
      subjectType: "その他",
      body: "宛先のない問い合わせ。",
      ip: `10.4.${tag.length}.1`,
    });
    expect(result).toMatchObject({ ok: false, status: 404 });
  });

  it("honeypot が埋まっていれば、成功に見せて保存も通知もしない", async () => {
    const from = mail("bot");
    const result = await submitContactMessage(app, {
      type: "association",
      associationId: S,
      senderName: "bot",
      senderEmail: from,
      subjectType: "その他",
      body: "bot",
      ip: `10.5.${tag.length}.1`,
      honeypot: "https://example.com",
    });
    expect(result.ok).toBe(true);
    const rows = await withTenantOn(owner, S, (tx) =>
      tx.select().from(contactMessages).where(eq(contactMessages.senderEmail, from)),
    );
    expect(rows).toHaveLength(0);
    expect(await owner.select().from(mailLogs).where(eq(mailLogs.toEmail, from))).toHaveLength(0);
  });

  it(`同じメールアドレスからは 1 時間に ${CONTACT_LIMIT_PER_HOUR} 件まで（超えたら 429）`, async () => {
    const from = mail("limit");
    const send = (n: number) =>
      submitContactMessage(app, {
        type: "platform",
        senderName: "問合 四郎",
        senderEmail: from,
        subjectType: "その他",
        body: `${n} 件目`,
        // IP はばらす（メールアドレスの方の上限を見る）
        ip: `10.6.${tag.length}.${n}`,
      });
    for (let n = 1; n <= CONTACT_LIMIT_PER_HOUR; n += 1) {
      expect((await send(n)).ok).toBe(true);
    }
    const over = await send(CONTACT_LIMIT_PER_HOUR + 1);
    expect(over).toMatchObject({ ok: false, status: 429 });
    if (over.ok) throw new Error("上限を超えても送れています");
    expect(over.retryAt).toBeInstanceOf(Date);
  });
});

describe("問い合わせの管理", () => {
  it("未対応だけの絞り込み・対応済みにする・未対応に戻す", async () => {
    const from = mail("admin");
    const result = await submitContactMessage(app, {
      type: "association",
      associationId: S,
      senderName: "問合 五郎",
      senderEmail: from,
      subjectType: "削除",
      body: "チームを解散したい。",
      ip: `10.7.${tag.length}.1`,
    });
    if (!result.ok) throw new Error("送信できていません");

    expect((await listSawara({ status: "new" })).map((r) => r.id)).toContain(result.messageId);
    expect(await setAssociationContactStatus(app, S, result.messageId, "done")).toBe(true);
    expect((await listSawara({ status: "new" })).map((r) => r.id)).not.toContain(result.messageId);
    expect((await listSawara()).find((r) => r.id === result.messageId)?.status).toBe("done");
    expect(await setAssociationContactStatus(app, S, result.messageId, "new")).toBe(true);
    expect((await listSawara({ status: "new" })).map((r) => r.id)).toContain(result.messageId);

    // 削除済み（A-26 で消す）は既定で出さない
    await withTenantOn(owner, S, (tx) =>
      tx.update(contactMessages).set({ deletedAt: new Date() }).where(eq(contactMessages.id, result.messageId)),
    );
    expect((await listSawara()).map((r) => r.id)).not.toContain(result.messageId);
    expect(await setAssociationContactStatus(app, S, result.messageId, "done")).toBe(false);
  });

  it("ほかの協会の問い合わせは見えないし、変えられない", async () => {
    const from = mail("tenant");
    const result = await submitContactMessage(app, {
      type: "association",
      associationId: otherAssociationId,
      senderName: "問合 六郎",
      senderEmail: from,
      subjectType: "その他",
      body: "ほかの協会宛て。",
      ip: `10.8.${tag.length}.1`,
    });
    if (!result.ok) throw new Error("送信できていません");

    expect((await listSawara()).map((r) => r.id)).not.toContain(result.messageId);
    expect(await setAssociationContactStatus(app, S, result.messageId, "done")).toBe(false);
    const rows = await listAssociationContacts(app, otherAssociationId);
    expect(rows.map((r) => r.id)).toContain(result.messageId);
    // 協会宛ての問い合わせは、運営者宛ての一覧にも出ない
    expect((await listPlatformContacts(app)).map((r) => r.id)).not.toContain(result.messageId);
  });

  it("運営者宛ては対応済みにできる。知らない受付番号は false", async () => {
    const from = mail("platform-admin");
    const result = await submitContactMessage(app, {
      type: "platform",
      senderName: "問合 七郎",
      senderEmail: from,
      subjectType: "ログイン",
      body: "ログインできません。",
      ip: `10.9.${tag.length}.1`,
    });
    if (!result.ok) throw new Error("送信できていません");

    expect((await listPlatformContacts(app, { status: "new" })).map((r) => r.id)).toContain(result.messageId);
    expect(await setPlatformContactStatus(app, result.messageId, "done")).toBe(true);
    expect((await listPlatformContacts(app, { status: "new" })).map((r) => r.id)).not.toContain(result.messageId);
    expect(await setPlatformContactStatus(app, "not-a-uuid", "done")).toBe(false);
    expect(await setPlatformContactStatus(app, "00000000-0000-4000-8000-000000000000", "done")).toBe(false);
  });
});
