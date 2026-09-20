import type { PlainDate } from "@/lib/date";
import { cleanText } from "@/lib/teams/team-input";
import { MAX_ENTRIES_LIMIT, readDateField, readIntField } from "./tournament-input";

// 大会の部の入力（設計書 §5.4「部門ごとの締切」「年齢の基準日」）。画面とサーバーの両方で使う
// 締切・基準日は空欄なら大会の値を使う（NULL = 上書きなし。有効な値の決め方は deadline.ts）
// 大会の値との突き合わせ（開始日より前の締切など）はサーバー側（src/lib/admin/categories.ts）

export const CATEGORY_LABEL_MAX = 60;

export type CategoryInput = {
  label: string;
  entryEndDate: PlainDate | null;
  ageReferenceDate: PlainDate | null;
  maxEntries: number | null;
};

export type CategoryField = "label" | "entryEndDate" | "ageReferenceDate" | "maxEntries";

export type CategoryInputResult = { ok: true; value: CategoryInput } | { ok: false; field: CategoryField; message: string };

const fail = (field: CategoryField, message: string): CategoryInputResult => ({ ok: false, field, message });

export function parseCategoryInput(raw: Record<string, unknown>): CategoryInputResult {
  const label = cleanText(raw.label);
  if (!label) return fail("label", "部の名前を入力してください");
  if ([...label].length > CATEGORY_LABEL_MAX) {
    return fail("label", `部の名前は${CATEGORY_LABEL_MAX}文字以内で入力してください`);
  }

  const entryEndDate = readDateField(raw.entryEndDate);
  if (entryEndDate === "invalid") return fail("entryEndDate", "締切日は年月日で入力してください");

  const ageReferenceDate = readDateField(raw.ageReferenceDate);
  if (ageReferenceDate === "invalid") return fail("ageReferenceDate", "年齢の基準日は年月日で入力してください");

  const maxEntries = readIntField(raw.maxEntries);
  if (maxEntries === "invalid") return fail("maxEntries", "申し込みの上限を数で入力してください（空欄なら大会の上限だけ）");
  if (maxEntries !== null && maxEntries < 1) {
    return fail("maxEntries", "申し込みの上限は 1 以上にしてください（空欄なら大会の上限だけ）");
  }
  if (maxEntries !== null && maxEntries > MAX_ENTRIES_LIMIT) {
    return fail("maxEntries", `申し込みの上限は${MAX_ENTRIES_LIMIT}以内にしてください`);
  }

  return { ok: true, value: { label, entryEndDate, ageReferenceDate, maxEntries } };
}
