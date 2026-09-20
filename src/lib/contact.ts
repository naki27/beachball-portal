import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { associations, contactMessages, platformContactMessages } from "@/db/schema";
import { normalizeEmail } from "@/lib/auth/login-input";
import { consumeRateLimits, HOUR_MS } from "@/lib/auth/rate-limit";
import { type ContactScope, isContactSubject } from "@/lib/contact-subjects";
import { isUuid } from "@/lib/ids";
import { enqueueMail } from "@/lib/mail/outbox";

// 問い合わせの受け付け（設計書 §5.10）。ログインしていなくても送れる
// 保存 → 受付控え（送信者）→ 転送（協会の連絡先メール。未設定なら CONTACT_TO）を同じトランザクションで積む
// 個人情報は mail_logs の params に入れない。雛形が受付番号から読む（§11「送り方」）

export type ContactSubmissionInput = {
  type: ContactScope;
  associationId?: string | null;
  userId?: string | null;
  senderName: string;
  senderEmail: string;
  subjectType: string;
  body: string;
  ip: string;
  honeypot?: string;
  entryId?: string | null;
};

export type ContactSubmissionResult =
  | { ok: true; messageId: string; forwardedTo: string | null }
  | { ok: false; status: 400 | 404 | 429; message: string; retryAt?: Date };

// 同じ IP・同じメールアドレスから 1 時間に 5 件まで（§5.10）
export const CONTACT_LIMIT_PER_HOUR = 5;

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function trimmed(value: string, max: number): string | null {
  const text = value.trim();
  if (!text || text.length > max) return null;
  return text;
}

export async function submitContactMessage(db: Db, input: ContactSubmissionInput): Promise<ContactSubmissionResult> {
  const name = trimmed(input.senderName, 100);
  if (!name) return { ok: false, status: 400, message: "お名前を入力してください" };
  const email = normalizeEmail(input.senderEmail);
  if (!email) return { ok: false, status: 400, message: "メールアドレスの形で入力してください" };
  const subject = input.subjectType.trim();
  if (!isContactSubject(subject, input.type)) {
    return { ok: false, status: 400, message: "お問い合わせの種類を選んでください" };
  }
  const body = trimmed(input.body, 2000);
  if (!body) return { ok: false, status: 400, message: "お問い合わせの内容を入力してください" };
  const entryId = input.entryId ?? null;
  if (entryId && !isUuid(entryId)) return { ok: false, status: 400, message: "送信できませんでした" };

  // ボットは保存も通知もせず、利用者には通常の成功として返す（honeypot・§5.10）
  if (input.honeypot?.trim()) {
    return { ok: true, messageId: crypto.randomUUID(), forwardedTo: null };
  }

  const limited = await consumeRateLimits(db, [
    { key: `contact:ip:${hashKey(input.ip || "unknown")}`, limit: CONTACT_LIMIT_PER_HOUR, windowMs: HOUR_MS },
    { key: `contact:email:${hashKey(email)}`, limit: CONTACT_LIMIT_PER_HOUR, windowMs: HOUR_MS },
  ]);
  if (!limited.allowed) {
    return { ok: false, status: 429, message: "しばらく送れません", retryAt: limited.retryAt };
  }

  if (input.type === "association") {
    if (!input.associationId || !isUuid(input.associationId)) {
      return { ok: false, status: 404, message: "協会が見つかりません" };
    }
    const [association] = await db
      .select({ id: associations.id, contactEmail: associations.contactEmail })
      .from(associations)
      .where(eq(associations.id, input.associationId))
      .limit(1);
    if (!association) return { ok: false, status: 404, message: "協会が見つかりません" };

    // 送信先はその協会の連絡先メール。未設定のときだけ CONTACT_TO（§5.10）
    const forwardTo = association.contactEmail ?? process.env.CONTACT_TO ?? null;
    const messageId = await withTenantOn(
      db,
      association.id,
      async (tx) => {
        const [row] = await tx
          .insert(contactMessages)
          .values({
            associationId: association.id,
            entryId,
            userId: input.userId ?? null,
            subjectType: subject,
            senderName: name,
            senderEmail: email,
            body,
          })
          .returning({ id: contactMessages.id });

        await enqueueMail(tx, {
          associationId: association.id,
          mailType: "contact_received",
          toEmail: email,
          userId: input.userId ?? null,
          entryId,
          params: { messageId: row.id, scope: "association" },
        });
        if (forwardTo) {
          await enqueueMail(tx, {
            associationId: association.id,
            mailType: "contact_forwarded",
            toEmail: forwardTo,
            userId: input.userId ?? null,
            entryId,
            params: { messageId: row.id, scope: "association" },
          });
        }
        return row.id;
      },
      input.userId ? { userId: input.userId } : {},
    );

    return { ok: true, messageId, forwardedTo: forwardTo };
  }

  // サイトの運営者宛て（テナントに属さない・§5.10）。転送先は CONTACT_TO だけ
  // 種別の再確認（上の検査で弾いているので通らない。保存できる種別に型を絞るため）
  if (!isContactSubject(subject, "platform")) {
    return { ok: false, status: 400, message: "お問い合わせの種類を選んでください" };
  }
  const forwardedTo = process.env.CONTACT_TO ?? null;
  const messageId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(platformContactMessages)
      .values({
        userId: input.userId ?? null,
        subjectType: subject,
        senderName: name,
        senderEmail: email,
        body,
      })
      .returning({ id: platformContactMessages.id });

    await enqueueMail(tx, {
      associationId: null,
      mailType: "contact_received",
      toEmail: email,
      userId: input.userId ?? null,
      params: { messageId: row.id, scope: "platform" },
    });
    if (forwardedTo) {
      await enqueueMail(tx, {
        associationId: null,
        mailType: "contact_forwarded",
        toEmail: forwardedTo,
        userId: input.userId ?? null,
        params: { messageId: row.id, scope: "platform" },
      });
    }
    return row.id;
  });

  return { ok: true, messageId, forwardedTo };
}
