// ログインの入力の正規化（設計書 §5.1・§9.2）。ブラウザとサーバーの両方で使うので、Node の API を import しない

export const CODE_LENGTH = 6;

// 入力欄の値から 6 桁を取り出す。全角数字・空白・ハイフンは受け付けて取り除く（§9.2）。6 桁にならなければ null
export function normalizeCodeInput(input: string): string | null {
  const digits = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-‐−ー]/g, "");
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(digits) ? digits : null;
}

// 戻り先として受け付けるのは、同じサイト内の相対パスだけ（/ で始まり // で始まらない・§5.2）。サーバーとブラウザの両方で使う
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

// メールアドレスの形式（§5.1「不正なメール形式は拒否」）。厳密な RFC ではなく、利用者の打ち間違いを弾く程度
// 小文字にそろえる（DB は citext だが、レート制限のキーのハッシュを安定させるため）
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
