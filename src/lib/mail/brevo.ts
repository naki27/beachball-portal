import type { MailSender, OutgoingMail, SendResult } from "./types";

// Brevo でのメール送信（設計書 §11.1・§11.2・X-01）。HTTP API（POST /v3/smtp/email）を使う
// 差出人は MAIL_FROM、表示名は協会の名前、返信先は協会の連絡先（呼ぶ側が渡す）
// 再試行はしない（送信待ちの仕組みが間隔を空けて再試行する・src/lib/mail/queue.ts）
// エラーの文に API キー・宛先・本文を入れない（状態と Brevo のエラーの記号だけ）

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_TIMEOUT_MS = 10_000;
// 表示名は 70 文字まで（Brevo の仕様）
const NAME_MAX_LENGTH = 70;

export type BrevoConfig = {
  apiKey: string;
  // 差出人のアドレス（MAIL_FROM。SPF・DKIM を通したドメイン・§11.1）
  from: string;
  // 表示名が渡されなかったときに使う名前
  defaultFromName: string;
  timeoutMs?: number;
};

type BrevoRecipient = {
  email: string;
  // 開封・クリックの記録を匿名化する。リンクの書き換え自体は 1 通ごとには切れないので
  // Brevo の画面で切る（docs/adr/0036・docs/ops.md）
  contactPixelTrackingConsent: false;
};

type BrevoBody = {
  sender: { email: string; name: string };
  to: BrevoRecipient[];
  subject: string;
  textContent: string;
  replyTo?: { email: string };
};

const clampName = (name: string) => name.slice(0, NAME_MAX_LENGTH);

export function buildBrevoBody(config: BrevoConfig, mail: OutgoingMail): BrevoBody {
  return {
    sender: { email: config.from, name: clampName(mail.fromName ?? config.defaultFromName) },
    to: [{ email: mail.to, contactPixelTrackingConsent: false }],
    subject: mail.subject,
    textContent: mail.text,
    ...(mail.replyTo ? { replyTo: { email: mail.replyTo } } : {}),
  };
}

// 失敗したときの文言。宛先・本文・API キーは入れず、状態と Brevo の `code`（決まった記号）だけを使う
async function failure(response: Response): Promise<Error> {
  let code = "";
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "code" in body && typeof body.code === "string") code = body.code;
  } catch {
    // 本文が JSON でないことがある（そのときは状態だけ）
  }
  return new Error(`Brevo がメールを受け付けませんでした（${response.status}${code ? ` ${code}` : ""}）`);
}

export function createBrevoSender(config: BrevoConfig, fetchImpl: typeof fetch = fetch): MailSender {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    async send(mail: OutgoingMail): Promise<SendResult> {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(buildBrevoBody(config, mail)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw await failure(response);
      const body: unknown = await response.json().catch(() => null);
      const messageId =
        body && typeof body === "object" && "messageId" in body && typeof body.messageId === "string" ? body.messageId : undefined;
      return messageId ? { providerMessageId: messageId } : {};
    },
  };
}
