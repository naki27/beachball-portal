import type { MemberSex, RefereeGrade } from "@/db/schema";
import { comparePlainDate, parsePlainDate, type PlainDate } from "@/lib/date";
import { cleanText, isKana } from "./team-input";

// 選手の項目（設計書 §5.11「名簿の管理」= §5.5 の選手項目: 氏名・ふりがな・生年月日・性別）
// 審判の資格（審判級・審判No）は任意の項目（K-01・ADR 0030）。名寄せのキーには入れない
// 画面（その場の検査）とサーバー（API）の両方で使う。サーバー専用の import を置かない
// 生年月日の和暦の入力はその部品（birth-date-field）が受け持ち、ここには "YYYY-MM-DD" で来る

export const PLAYER_NAME_MAX = 50;
export const PLAYER_KANA_MAX = 50;
const BIRTH_YEAR_MIN = 1900;

export const SEX_CHOICES: readonly { id: MemberSex; label: string }[] = [
  { id: "male", label: "男性" },
  { id: "female", label: "女性" },
];
export const SEX_LABEL: Record<MemberSex, string> = { male: "男性", female: "女性" };

// 審判の資格（K-01）。級は色でも分かれているが、色だけに頼らず必ず文字を添える（§4.5 原則 2）
export const REFEREE_NO_DIGITS = 6;
export const REFEREE_GRADE_CHOICES: readonly { id: RefereeGrade; label: string; color: string }[] = [
  { id: "a", label: "A級", color: "赤" },
  { id: "b", label: "B級", color: "黄" },
  { id: "c", label: "C級", color: "白" },
];
// 画面に出す文言（§4.4）。「なし」は値を持たない（null）
export const REFEREE_GRADE_LABEL: Record<RefereeGrade, string> = { a: "A級（赤）", b: "B級（黄）", c: "C級（白）" };
export const REFEREE_GRADE_NONE = "なし";

// 審判の資格。どちらも任意（未登録は null）
export type RefereeInput = { refereeGrade: RefereeGrade | null; refereeNo: string | null };

export type PlayerInput = { name: string; kana: string | null; birthDate: string; sex: MemberSex } & RefereeInput;

export type PlayerField = "name" | "kana" | "birthDate" | "sex" | "refereeGrade" | "refereeNo";

export type PlayerInputResult = { ok: true; value: PlayerInput } | { ok: false; field: PlayerField; message: string };

export function parsePlayerInput(raw: Record<string, unknown>, today: PlainDate): PlayerInputResult {
  const name = cleanText(raw.name);
  if (!name) return { ok: false, field: "name", message: "氏名を入力してください" };
  if ([...name].length > PLAYER_NAME_MAX) return { ok: false, field: "name", message: `氏名は${PLAYER_NAME_MAX}文字以内で入力してください` };

  const kana = cleanText(raw.kana);
  if ([...kana].length > PLAYER_KANA_MAX) return { ok: false, field: "kana", message: `ふりがなは${PLAYER_KANA_MAX}文字以内で入力してください` };
  if (kana && !isKana(kana)) return { ok: false, field: "kana", message: "ふりがなはひらがなで入力してください" };

  const birth = typeof raw.birthDate === "string" ? parsePlainDate(raw.birthDate) : null;
  if (!birth) return { ok: false, field: "birthDate", message: "生年月日を入力してください" };
  if (birth.year < BIRTH_YEAR_MIN || comparePlainDate(birth, today) > 0) {
    return { ok: false, field: "birthDate", message: "生年月日を確かめてください" };
  }

  const sex = raw.sex === "male" || raw.sex === "female" ? raw.sex : null;
  if (!sex) return { ok: false, field: "sex", message: "性別を選んでください" };

  const referee = parseRefereeInput(raw);
  if (!referee.ok) return referee;

  return { ok: true, value: { name, kana: kana || null, birthDate: raw.birthDate as string, sex, ...referee.value } };
}

export type RefereeInputResult = { ok: true; value: RefereeInput } | { ok: false; field: PlayerField; message: string };

// 審判の資格（K-01）。どちらも任意。級は「なし」（空・"none"）なら null、審判No は数字 6 桁だけ
export function parseRefereeInput(raw: Record<string, unknown>): RefereeInputResult {
  const rawGrade = cleanText(raw.refereeGrade).toLowerCase();
  const grade = REFEREE_GRADE_CHOICES.find((c) => c.id === rawGrade)?.id ?? null;
  if (rawGrade && rawGrade !== "none" && !grade) return { ok: false, field: "refereeGrade", message: "審判級を選んでください" };

  // 全角の数字は cleanText の NFKC で半角になる
  const no = cleanText(raw.refereeNo).replace(/[\s-]/g, "");
  if (no && !new RegExp(`^[0-9]{${REFEREE_NO_DIGITS}}$`).test(no)) {
    return { ok: false, field: "refereeNo", message: `審判Noは数字${REFEREE_NO_DIGITS}桁で入力してください` };
  }

  return { ok: true, value: { refereeGrade: grade, refereeNo: no || null } };
}
