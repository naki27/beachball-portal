import { SITE_NAME } from "@/lib/site";
import type { MailType, OutgoingMail } from "./types";

// メールの本文（設計書 §11）。送る直前に params の ID から組み立てる。本文にリンクを載せるのは §11 の表で決めたものだけ
// 件名の先頭は【協会名】、協会に属さないメールは【サイト名】

export type ComposeContext = {
  // 協会に属さないメールは null
  associationName: string | null;
  baseUrl: string;
};

export type Composed = Pick<OutgoingMail, "subject" | "text">;

export function brandOf(ctx: Pick<ComposeContext, "associationName">): string {
  return ctx.associationName ?? SITE_NAME;
}

export function subjectWithBrand(ctx: Pick<ComposeContext, "associationName">, subject: string): string {
  return `【${brandOf(ctx)}】${subject}`;
}

type Template = (params: Record<string, unknown>, ctx: ComposeContext) => Composed;

// 送信待ちから送る種別の雛形。ここにないものは送れず failed になる（各タスクで足す）
const TEMPLATES: Partial<Record<MailType, Template>> = {
  test: (params, ctx) => ({
    subject: subjectWithBrand(ctx, "テスト送信"),
    text: [
      `これは ${brandOf(ctx)} のテストメールです。`,
      "",
      typeof params.note === "string" && params.note ? `メモ: ${params.note}` : "",
      "",
      "このメールに心当たりがない場合は、無視してください。",
    ].join("\n"),
  }),
};

export function hasTemplate(mailType: string): mailType is MailType {
  return mailType in TEMPLATES;
}

export function composeMail(mailType: MailType, params: Record<string, unknown>, ctx: ComposeContext): Composed {
  const template = TEMPLATES[mailType];
  if (!template) throw new Error(`メールの雛形がありません: ${mailType}`);
  return template(params, ctx);
}

// 確認番号のメール（§11 の login_code / email_change_code）。送信待ちには積まず、応答の前に直接送る（A-08）
// 件名に番号。本文は番号を大きく、有効期限、心当たりがなければ無視する旨。リンクは載せない（§9.3）
export function composeLoginCodeMail(input: {
  code: string;
  ttlMinutes: number;
  associationName: string | null;
  purpose: "login" | "email_change";
}): Composed {
  const brand = brandOf({ associationName: input.associationName });
  const what = input.purpose === "login" ? "ログイン" : "メールアドレスの変更";
  return {
    subject: subjectWithBrand({ associationName: input.associationName }, `確認番号 ${input.code}`),
    text: [
      `${brand} の${what}の確認番号です。`,
      "",
      `　　${input.code}`,
      "",
      `この番号は ${input.ttlMinutes} 分間だけ使えます。画面に入力してください。`,
      "",
      "このメールに心当たりがない場合は、無視してください。番号を知らない人はログインできません。",
      `メールの本文にリンクは載せていません。いつものブラウザで ${brand} のページを開いてください。`,
    ].join("\n"),
  };
}
