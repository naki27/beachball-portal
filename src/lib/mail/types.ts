// メール（設計書 §11）。種別の一覧は §11 の表。P1 のものも名前だけ置く（送る側の実装は各タスクで）
export const MAIL_TYPES = [
  "login_code", // 確認番号（応答の前に直接送る。送信待ちには積まない・§11「送り方」）
  "email_change_code", // 同上
  "entry_completed",
  "entry_updated",
  "entry_cancelled",
  "contact_received",
  "contact_forwarded",
  "email_changed",
  "membership_applied",
  "membership_approved",
  "team_admin_granted",
  "team_invitation",
  "team_invitation_accepted",
  "team_invitation_rejected",
  "team_invitation_expired",
  "association_admin_invitation",
  "association_admin_invitation_rejected",
  "association_admin_invitation_expired",
  "test", // 開発用（pnpm mail:test）
] as const;

export type MailType = (typeof MAIL_TYPES)[number];

// 組み立て済みのメール（本文は送る直前に params から作る。DB には保存しない）
export type OutgoingMail = {
  to: string;
  subject: string;
  text: string;
};

export type SendResult = {
  providerMessageId?: string;
};

// 送信サービスの差し替え口（§11.2「切り替え」）。console / smtp（Mailpit）はここ、Brevo は X-01
export type MailSender = {
  send(mail: OutgoingMail): Promise<SendResult>;
  close?(): Promise<void>;
};
