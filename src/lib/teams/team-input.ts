import { normalizeEmail } from "@/lib/auth/login-input";

// チーム情報の入力（設計書 §5.11「チームの作り方」）。チーム名だけで作れる。ほかは任意・後から追記できる
// 画面（その場の検査）とサーバー（API）の両方で使う。サーバー専用の import を置かない

export const TEAM_NAME_MAX = 50;
export const TEAM_KANA_MAX = 50;

export type TeamInput = {
  name: string;
  kana: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  membershipRenewalTarget: boolean;
};

export type TeamField = "name" | "kana" | "contactEmail" | "contactPhone";

export type TeamInputResult = { ok: true; value: TeamInput } | { ok: false; field: TeamField; message: string };

// 文字の欄を整える: NFKC・続く空白は 1 つ・前後の空白を除く。文字列でなければ空
export function cleanText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFKC").replace(/\s+/g, " ").trim() : "";
}

// ふりがなの形（ひらがな・カタカナ・長音・中黒・空白）
export function isKana(value: string): boolean {
  return /^[\p{Script=Hiragana}\p{Script=Katakana}ー・ ]+$/u.test(value);
}

const text = cleanText;

export function parseTeamInput(raw: Record<string, unknown>): TeamInputResult {
  const name = text(raw.name);
  if (!name) return { ok: false, field: "name", message: "チーム名を入力してください" };
  if ([...name].length > TEAM_NAME_MAX) return { ok: false, field: "name", message: `チーム名は${TEAM_NAME_MAX}文字以内で入力してください` };

  const kana = text(raw.kana);
  if ([...kana].length > TEAM_KANA_MAX) return { ok: false, field: "kana", message: `ふりがなは${TEAM_KANA_MAX}文字以内で入力してください` };
  if (kana && !isKana(kana)) {
    return { ok: false, field: "kana", message: "ふりがなはひらがなで入力してください" };
  }

  const emailText = text(raw.contactEmail);
  const contactEmail = emailText ? normalizeEmail(emailText) : null;
  if (emailText && !contactEmail) return { ok: false, field: "contactEmail", message: "メールアドレスの形で入力してください（例: taro@example.com）" };

  const phone = text(raw.contactPhone);
  const digits = phone.replace(/\D/g, "");
  if (phone && (!/^[0-9+\-() ]+$/.test(phone) || digits.length < 10 || digits.length > 15)) {
    return { ok: false, field: "contactPhone", message: "電話番号の形で入力してください（例: 090-1234-5678）" };
  }

  return {
    ok: true,
    value: {
      name,
      kana: kana || null,
      contactEmail,
      contactPhone: phone || null,
      membershipRenewalTarget: raw.membershipRenewalTarget === true,
    },
  };
}
