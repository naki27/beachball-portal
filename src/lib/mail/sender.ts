import nodemailer from "nodemailer";
import type { MailSender, OutgoingMail } from "./types";

// 送信サービスの実装。環境変数 MAIL_PROVIDER で選ぶ（§6.3）
//   console: 標準出力に出すだけ（ローカルの開発用。本番では使えない）
//   smtp / mailpit: SMTP_URL（例: smtp://mailpit:1025）へ送る。ローカルでは Mailpit が受ける
//   brevo: X-01 で実装する

export function createConsoleSender(): MailSender {
  return {
    async send(mail: OutgoingMail) {
      console.log(`--- mail to ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n--- end of mail`);
      return {};
    },
  };
}

export function createSmtpSender(smtpUrl: string, from: string): MailSender {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(mail: OutgoingMail) {
      const info = await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
      return { providerMessageId: info.messageId };
    },
    async close() {
      transport.close();
    },
  };
}

export type MailEnv = {
  MAIL_PROVIDER?: string;
  MAIL_FROM?: string;
  SMTP_URL?: string;
  NODE_ENV?: string;
};

// アプリ用の送信口（確認番号のメールなど、応答の前に直接送るもの）。最初に使うときに作り、globalThis に 1 つ置く
const store = globalThis as unknown as { __beachballMailSender?: MailSender };

export function getMailSender(): MailSender {
  store.__beachballMailSender ??= createMailSender();
  return store.__beachballMailSender;
}

export function createMailSender(env: MailEnv = process.env): MailSender {
  const provider = env.MAIL_PROVIDER ?? "console";
  const from = env.MAIL_FROM ?? "noreply@localhost";
  switch (provider) {
    case "console":
      if (env.NODE_ENV === "production") throw new Error("MAIL_PROVIDER=console は本番では使えません");
      return createConsoleSender();
    case "smtp":
    case "mailpit":
      return createSmtpSender(env.SMTP_URL ?? "smtp://mailpit:1025", from);
    case "brevo":
      throw new Error("MAIL_PROVIDER=brevo は X-01 で実装します");
    default:
      throw new Error(`MAIL_PROVIDER の値が不明です: ${provider}`);
  }
}
