import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { associationAdminInvitations, members, teamInvitations, teams, users } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import { SITE_NAME } from "@/lib/site";
import type { MailType, OutgoingMail } from "./types";

// メールの本文（設計書 §11）。送る直前に params の ID から組み立てる（本文は保存しない）。本文にリンクを載せるのは §11 の表で決めたものだけ
// 件名の先頭は【協会名】、協会に属さないメールは【サイト名】
// 雛形は tx（協会に属するメールなら、その協会に固定したトランザクション）で ID から行を読む

export type ComposeContext = {
  // 協会に属さないメールは null
  associationName: string | null;
  associationSlug: string | null;
  baseUrl: string;
};

export type Composed = Pick<OutgoingMail, "subject" | "text">;

export function brandOf(ctx: Pick<ComposeContext, "associationName">): string {
  return ctx.associationName ?? SITE_NAME;
}

export function subjectWithBrand(ctx: Pick<ComposeContext, "associationName">, subject: string): string {
  return `【${brandOf(ctx)}】${subject}`;
}

type Template = (params: Record<string, unknown>, ctx: ComposeContext, tx: Tx | Db) => Promise<Composed>;

function associationTopUrl(ctx: ComposeContext): string {
  return ctx.associationSlug ? `${ctx.baseUrl}/${ctx.associationSlug}/` : `${ctx.baseUrl}/`;
}

function untilText(expiresAt: Date): string {
  return `${formatDateWithWeekday(todayInTokyo(expiresAt))}まで`;
}

async function loadAdminInvitation(tx: Tx | Db, params: Record<string, unknown>) {
  const id = typeof params.invitationId === "string" ? params.invitationId : "";
  const [row] = await tx.select().from(associationAdminInvitations).where(eq(associationAdminInvitations.id, id)).limit(1);
  if (!row) throw new Error("招待がありません");
  return row;
}

// 選手・代表者としての招待（§5.15）。チーム名・人物の氏名・招待した代表者の表示名を ID から読む（本文は保存しない）
async function loadTeamInvitation(tx: Tx | Db, params: Record<string, unknown>) {
  const id = typeof params.invitationId === "string" ? params.invitationId : "";
  const [row] = await tx.select().from(teamInvitations).where(eq(teamInvitations.id, id)).limit(1);
  if (!row) throw new Error("招待がありません");
  const [team] = await tx.select({ name: teams.name }).from(teams).where(eq(teams.id, row.teamId)).limit(1);
  const [member] = row.memberId ? await tx.select({ name: members.name }).from(members).where(eq(members.id, row.memberId)).limit(1) : [];
  const [inviter] = await tx.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.invitedBy)).limit(1);
  return {
    ...row,
    teamName: team?.name ?? "チーム",
    memberName: member?.name ?? null,
    inviterName: inviter?.displayName ?? null,
    roleText: row.kind === "admin" ? "代表者" : `選手${member?.name ? `（${member.name}）` : ""}`,
  };
}

// 送信待ちから送る種別の雛形。ここにないものは送れず failed になる（各タスクで足す）
const TEMPLATES: Partial<Record<MailType, Template>> = {
  test: async (params, ctx) => ({
    subject: subjectWithBrand(ctx, "テスト送信"),
    text: [
      `これは ${brandOf(ctx)} のテストメールです。`,
      "",
      typeof params.note === "string" && params.note ? `メモ: ${params.note}` : "",
      "",
      "このメールに心当たりがない場合は、無視してください。",
    ].join("\n"),
  }),

  // テナント管理者の招待（§5.14・§11）: 協会名・協会のトップの URL・ログインに使うアドレス・期限・いつものブラウザで
  association_admin_invitation: async (params, ctx, tx) => {
    const invitation = await loadAdminInvitation(tx, params);
    const brand = brandOf(ctx);
    return {
      subject: subjectWithBrand(ctx, "協会の管理者への招待"),
      text: [
        `${brand} の管理者として招待されました。`,
        "",
        "次の手順で参加してください。",
        `1. いつものブラウザ（Safari・Chrome）で ${associationTopUrl(ctx)} を開く`,
        `2. 「ログイン」から、このメールを受け取ったアドレス（${invitation.email}）でログインする`,
        "3. 「招待」の画面で「参加する」を押す",
        "",
        `期限: ${untilText(invitation.expiresAt)}`,
        "",
        "ホーム画面に追加したアプリや LINE の中ではなく、いつものブラウザで使ってください（管理者は同時に 1 つの端末でしかログインできません）。",
        "このメールに心当たりがない場合は、招待の画面で「心当たりがない」を選ぶか、無視してください。",
      ].join("\n"),
    };
  },

  // 選手・代表者としての招待（§5.15・§11）: 協会名・チーム名・招待した代表者の表示名、ログインに使うアドレス、期限、協会のトップの URL
  team_invitation: async (params, ctx, tx) => {
    const i = await loadTeamInvitation(tx, params);
    const who = i.inviterName ? `代表者の ${i.inviterName} さん` : "代表者";
    return {
      subject: subjectWithBrand(ctx, `${i.teamName}からの招待`),
      text: [
        `${brandOf(ctx)} の ${i.teamName} の${who}から、${i.roleText}として招待されました。`,
        "",
        "次の手順で参加してください。",
        `1. いつものブラウザ（Safari・Chrome）で ${associationTopUrl(ctx)} を開く`,
        `2. 「ログイン」から、このメールを受け取ったアドレス（${i.email}）でログインする`,
        "3. 「招待」の画面で「参加する」を押す",
        "",
        `期限: ${untilText(i.expiresAt)}`,
        "",
        "別のアドレスでログインすると招待は見えません。",
        "このメールに心当たりがない場合は、招待の画面で「心当たりがない」を選ぶか、無視してください。",
      ].join("\n"),
    };
  },

  team_invitation_accepted: async (params, ctx, tx) => {
    const i = await loadTeamInvitation(tx, params);
    return {
      subject: subjectWithBrand(ctx, `${i.teamName}への招待に返事がありました`),
      text: [
        i.kind === "admin"
          ? `${i.email} さんが ${i.teamName} の代表者になりました。`
          : `${i.memberName ?? "招待した方"}さんが ${i.teamName} に参加しました。`,
        `本人は ${brandOf(ctx)} のページで、選手一覧や申し込みを見られるようになりました。`,
      ].join("\n"),
    };
  },

  team_invitation_rejected: async (params, ctx, tx) => {
    const i = await loadTeamInvitation(tx, params);
    return {
      subject: subjectWithBrand(ctx, `${i.teamName}への招待が断られました`),
      text: [
        `${i.teamName} の${i.roleText}としての招待（${i.email}）は「心当たりがない」と返事がありました。`,
        "メールアドレスを確かめてください。",
      ].join("\n"),
    };
  },

  team_invitation_expired: async (params, ctx, tx) => {
    const i = await loadTeamInvitation(tx, params);
    return {
      subject: subjectWithBrand(ctx, `${i.teamName}への招待の期限が切れました`),
      text: [
        `${i.teamName} の${i.roleText}としての招待（${i.email}）は期限（${untilText(i.expiresAt)}）が過ぎました。`,
        "必要なら、選手一覧の画面からもう一度送ってください。",
      ].join("\n"),
    };
  },

  association_admin_invitation_rejected: async (params, ctx, tx) => {
    const invitation = await loadAdminInvitation(tx, params);
    return {
      subject: subjectWithBrand(ctx, "管理者への招待が断られました"),
      text: [
        `${brandOf(ctx)} の管理者への招待（${invitation.email}）は「心当たりがない」と返事がありました。`,
        "メールアドレスを確かめてください。",
      ].join("\n"),
    };
  },

  association_admin_invitation_expired: async (params, ctx, tx) => {
    const invitation = await loadAdminInvitation(tx, params);
    return {
      subject: subjectWithBrand(ctx, "管理者への招待の期限が切れました"),
      text: [
        `${brandOf(ctx)} の管理者への招待（${invitation.email}）は期限（${untilText(invitation.expiresAt)}）が過ぎました。`,
        "必要なら、運営管理の画面からもう一度送ってください。",
      ].join("\n"),
    };
  },
};

export function hasTemplate(mailType: string): mailType is MailType {
  return mailType in TEMPLATES;
}

export async function composeMail(
  mailType: MailType,
  params: Record<string, unknown>,
  ctx: ComposeContext,
  tx: Tx | Db,
): Promise<Composed> {
  const template = TEMPLATES[mailType];
  if (!template) throw new Error(`メールの雛形がありません: ${mailType}`);
  return template(params, ctx, tx);
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
