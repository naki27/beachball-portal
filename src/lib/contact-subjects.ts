// 問い合わせの種別（設計書 §5.10）。DB に入れるのは短い値、画面・メールに出すのは §4.4 の言い方
// 値と言い方の対応はここだけに置く（画面・API・メールの雛形が同じものを使う）

export type ContactScope = "association" | "platform";

export const CONTACT_SUBJECTS = [
  { value: "変更", label: "申し込み内容の変更", platform: false },
  { value: "取消", label: "申し込みの取消", platform: false },
  { value: "ログイン", label: "ログインできない・メールが届かない", platform: true },
  { value: "削除", label: "チームの解散・アカウントの削除", platform: true },
  { value: "その他", label: "その他", platform: true },
] as const;

export type ContactSubject = (typeof CONTACT_SUBJECTS)[number]["value"];
// サイトの運営者宛てに選べる種別だけ（付録 A の platform_contact_messages の check と同じ）
export type PlatformContactSubject = Extract<ContactSubject, "ログイン" | "削除" | "その他">;

// サイトの運営者宛ては、申し込みに関わる種別を出さない（付録 A の check と同じ）
export function subjectsFor(scope: ContactScope): readonly (typeof CONTACT_SUBJECTS)[number][] {
  return scope === "platform" ? CONTACT_SUBJECTS.filter((s) => s.platform) : CONTACT_SUBJECTS;
}

export function isContactSubject<S extends ContactScope>(
  value: string,
  scope: S,
): value is S extends "platform" ? PlatformContactSubject : ContactSubject {
  return subjectsFor(scope).some((s) => s.value === value);
}

// 画面・メールに出す言い方。知らない値はそのまま返す
export function subjectLabel(value: string): string {
  return CONTACT_SUBJECTS.find((s) => s.value === value)?.label ?? value;
}
