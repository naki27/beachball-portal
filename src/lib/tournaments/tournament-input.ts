import { comparePlainDate, parsePlainDate, type PlainDate } from "@/lib/date";
import { cleanText } from "@/lib/teams/team-input";

// 大会の入力（設計書 §5.4）。画面（その場の検査）とサーバー（API）の両方で使う。サーバー専用の import を置かない
// 日付は「年月日」だけで入力する（時刻を画面に出さない・§4.3）。0:00 / 23:59:59 への変換は保存する側（tournaments.ts）
// 1 つの表の中で完結する整合性はここで見る。部門の設定値と突き合わせる検証は tournaments.ts（表をまたぐ・§5.4）

export const TOURNAMENT_NAME_MAX = 80;
export const TOURNAMENT_VENUE_MAX = 100;
export const TOURNAMENT_DESCRIPTION_MAX = 2000;
export const TEAM_SIZE_LIMIT = 30; // 入力の上限（現実的な値。部門のコート人数との関係は別に見る）
export const MAX_ENTRIES_LIMIT = 1000;

export const TOURNAMENT_STATUSES = ["draft", "open", "closed", "archived"] as const;
export type TournamentInputStatus = (typeof TOURNAMENT_STATUSES)[number];

// 管理画面に出す状態の呼び名（内部の値を画面に出さない・§4.4）。docs/adr/0021
export const TOURNAMENT_STATUS_LABEL: Record<TournamentInputStatus, string> = {
  draft: "準備中（公開しない）",
  open: "受付中（公開する）",
  closed: "受付を終了（公開する）",
  archived: "終了した大会",
};

export type TournamentInput = {
  name: string;
  eventDate: PlainDate | null;
  ageReferenceDate: PlainDate;
  venue: string | null;
  description: string | null;
  entryStartDate: PlainDate | null;
  entryEndDate: PlainDate;
  teamSizeMin: number;
  teamSizeMax: number;
  maxEntries: number | null;
  status: TournamentInputStatus;
};

export type TournamentField =
  | "name"
  | "eventDate"
  | "ageReferenceDate"
  | "venue"
  | "description"
  | "entryStartDate"
  | "entryEndDate"
  | "teamSizeMin"
  | "teamSizeMax"
  | "maxEntries"
  | "status";

export type TournamentInputResult =
  | { ok: true; value: TournamentInput }
  | { ok: false; field: TournamentField; message: string };

const fail = (field: TournamentField, message: string): TournamentInputResult => ({ ok: false, field, message });

// 「YYYY-MM-DD」の欄を読む。空なら null、形が違う・存在しない日付なら "invalid"
function readDate(value: unknown): PlainDate | null | "invalid" {
  const text = cleanText(value).replace(/[/.]/g, "-");
  if (!text) return null;
  return parsePlainDate(text) ?? "invalid";
}

// 数の欄を読む。空なら null、整数でなければ "invalid"
function readInt(value: unknown): number | null | "invalid" {
  if (typeof value === "number") return Number.isInteger(value) ? value : "invalid";
  const text = cleanText(value);
  if (!text) return null;
  return /^\d+$/.test(text) ? Number(text) : "invalid";
}

export function parseTournamentInput(raw: Record<string, unknown>): TournamentInputResult {
  const name = cleanText(raw.name);
  if (!name) return fail("name", "大会名を入力してください");
  if ([...name].length > TOURNAMENT_NAME_MAX) {
    return fail("name", `大会名は${TOURNAMENT_NAME_MAX}文字以内で入力してください`);
  }

  const eventDate = readDate(raw.eventDate);
  if (eventDate === "invalid") return fail("eventDate", "開催日は年月日で入力してください");

  // 年齢の基準日は必須。空のときは開催日を使う（画面は開催日を既定値として入れておく・§14-21）
  const referenceInput = readDate(raw.ageReferenceDate);
  if (referenceInput === "invalid") return fail("ageReferenceDate", "年齢の基準日は年月日で入力してください");
  const ageReferenceDate = referenceInput ?? eventDate;
  if (!ageReferenceDate) return fail("ageReferenceDate", "年齢の基準日を入力してください");

  const venue = cleanText(raw.venue);
  if ([...venue].length > TOURNAMENT_VENUE_MAX) {
    return fail("venue", `会場は${TOURNAMENT_VENUE_MAX}文字以内で入力してください`);
  }
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if ([...description].length > TOURNAMENT_DESCRIPTION_MAX) {
    return fail("description", `説明は${TOURNAMENT_DESCRIPTION_MAX}文字以内で入力してください`);
  }

  const entryStartDate = readDate(raw.entryStartDate);
  if (entryStartDate === "invalid") return fail("entryStartDate", "申し込みの開始日は年月日で入力してください");
  const entryEndDate = readDate(raw.entryEndDate);
  if (entryEndDate === "invalid") return fail("entryEndDate", "締切日は年月日で入力してください");
  if (!entryEndDate) return fail("entryEndDate", "締切日を入力してください");
  // 開始はその日の 0:00、締切はその日の 23:59:59 なので、同じ日なら「その日だけ受付」で成り立つ
  if (entryStartDate && comparePlainDate(entryStartDate, entryEndDate) > 0) {
    return fail("entryEndDate", "締切日は申し込みの開始日と同じ日か、それより後にしてください");
  }

  const teamSizeMin = readInt(raw.teamSizeMin);
  if (teamSizeMin === "invalid" || teamSizeMin === null) return fail("teamSizeMin", "参加人数の下限を数で入力してください");
  if (teamSizeMin < 1) return fail("teamSizeMin", "参加人数の下限は 1 人以上にしてください");
  if (teamSizeMin > TEAM_SIZE_LIMIT) return fail("teamSizeMin", `参加人数の下限は${TEAM_SIZE_LIMIT}人以内にしてください`);
  const teamSizeMax = readInt(raw.teamSizeMax);
  if (teamSizeMax === "invalid" || teamSizeMax === null) return fail("teamSizeMax", "参加人数の上限を数で入力してください");
  if (teamSizeMax > TEAM_SIZE_LIMIT) return fail("teamSizeMax", `参加人数の上限は${TEAM_SIZE_LIMIT}人以内にしてください`);
  if (teamSizeMin > teamSizeMax) return fail("teamSizeMax", "参加人数の上限は下限以上にしてください");

  const maxEntries = readInt(raw.maxEntries);
  if (maxEntries === "invalid") return fail("maxEntries", "申し込みの上限を数で入力してください（空欄なら上限なし）");
  if (maxEntries !== null && maxEntries < 1) {
    return fail("maxEntries", "申し込みの上限は 1 以上にしてください（空欄なら上限なし）");
  }
  if (maxEntries !== null && maxEntries > MAX_ENTRIES_LIMIT) {
    return fail("maxEntries", `申し込みの上限は${MAX_ENTRIES_LIMIT}以内にしてください`);
  }

  const statusText = cleanText(raw.status) || "draft";
  if (!(TOURNAMENT_STATUSES as readonly string[]).includes(statusText)) {
    return fail("status", "公開の状態を選んでください");
  }

  return {
    ok: true,
    value: {
      name,
      eventDate,
      ageReferenceDate,
      venue: venue || null,
      description: description || null,
      entryStartDate,
      entryEndDate,
      teamSizeMin,
      teamSizeMax,
      maxEntries,
      status: statusText as TournamentInputStatus,
    },
  };
}
