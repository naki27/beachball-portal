import type { MemberSex } from "@/db/schema";
import { comparePlainDate, parsePlainDate, type PlainDate } from "@/lib/date";
import { cleanText, isKana } from "./team-input";

// 選手の項目（設計書 §5.11「名簿の管理」= §5.5 の選手項目: 氏名・ふりがな・生年月日・性別）
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

export type PlayerInput = { name: string; kana: string | null; birthDate: string; sex: MemberSex };

export type PlayerField = "name" | "kana" | "birthDate" | "sex";

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

  return { ok: true, value: { name, kana: kana || null, birthDate: raw.birthDate as string, sex } };
}
