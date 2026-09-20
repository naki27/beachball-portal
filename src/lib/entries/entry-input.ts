import { isUuid } from "@/lib/ids";
import { cleanText, TEAM_NAME_MAX } from "@/lib/teams/team-input";

// 大会申込の入力（設計書 §5.5「入力ページ」）。画面（その場の検査）とサーバーの両方で使う
// ここで見るのは B-07 の範囲（チーム・公開するチーム名・出場する部・備考・送信用のワンタイムの値）
// 選手枠は B-09、締切・定員・資格の判定は送信する側（B-10。deadline.ts と eligibility.ts を通す）

export const ENTRY_NOTE_MAX = 1000;

export type EntryInput = {
  // 代表者を務めるチームを選んだとき。その場で作るときは null
  teamId: string | null;
  // その場で作るチームの名前（teamId が null のときだけ）
  newTeamName: string | null;
  // 参加チーム一覧に出る名前（entries.team_name）。登録チームの名前は変えない（§5.5）
  teamName: string;
  categoryId: string;
  note: string | null;
  // 入力ページを開いたときに発行し、送信時に消費する（二重送信を防ぐ・§5.5）
  token: string;
};

export type EntryField = "teamId" | "newTeamName" | "teamName" | "categoryId" | "note" | "token";

export type EntryInputResult = { ok: true; value: EntryInput } | { ok: false; field: EntryField; message: string };

const fail = (field: EntryField, message: string): EntryInputResult => ({ ok: false, field, message });

export function parseEntryInput(raw: Record<string, unknown>): EntryInputResult {
  const teamIdText = cleanText(raw.teamId);
  const teamId = teamIdText || null;
  if (teamId && !isUuid(teamId)) return fail("teamId", "申し込むチームを選んでください");

  // チームがないときは、その場で作る名前が要る（別のページに飛ばさない・§5.11）
  const newTeamName = teamId ? null : cleanText(raw.newTeamName);
  if (!teamId) {
    if (!newTeamName) return fail("newTeamName", "チーム名を入力してください");
    if ([...newTeamName].length > TEAM_NAME_MAX) return fail("newTeamName", `チーム名は${TEAM_NAME_MAX}文字以内で入力してください`);
  }

  // 公開されるチーム名。空欄なら、選んだチーム名（画面が初期値として入れる）かその場で作る名前
  const teamName = cleanText(raw.teamName) || newTeamName || "";
  if (!teamName) return fail("teamName", "チーム名を入力してください");
  if ([...teamName].length > TEAM_NAME_MAX) return fail("teamName", `チーム名は${TEAM_NAME_MAX}文字以内で入力してください`);

  const categoryId = cleanText(raw.categoryId);
  if (!categoryId) return fail("categoryId", "出場する部を選んでください");
  if (!isUuid(categoryId)) return fail("categoryId", "出場する部を選んでください");

  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if ([...note].length > ENTRY_NOTE_MAX) return fail("note", `備考は${ENTRY_NOTE_MAX}文字以内で入力してください`);

  const token = cleanText(raw.token);
  if (!token) return fail("token", "画面を開き直してから、もう一度お試しください");

  return { ok: true, value: { teamId, newTeamName: newTeamName || null, teamName, categoryId, note: note || null, token } };
}

// 申込の変更（B-12・§5.5(d)）。チームは変えられない（変えるなら取り消して申し込み直す）ので、
// 見るのは公開するチーム名・出場する部・備考だけ。ワンタイムの値も要らない（申込はすでにある）
export type EntryEditInput = { teamName: string; categoryId: string; note: string | null };

export type EntryEditField = "teamName" | "categoryId" | "note";

export type EntryEditInputResult =
  | { ok: true; value: EntryEditInput }
  | { ok: false; field: EntryEditField; message: string };

export function parseEntryEditInput(raw: Record<string, unknown>): EntryEditInputResult {
  const teamName = cleanText(raw.teamName);
  if (!teamName) return { ok: false, field: "teamName", message: "チーム名を入力してください" };
  if ([...teamName].length > TEAM_NAME_MAX) {
    return { ok: false, field: "teamName", message: `チーム名は${TEAM_NAME_MAX}文字以内で入力してください` };
  }

  const categoryId = cleanText(raw.categoryId);
  if (!categoryId || !isUuid(categoryId)) return { ok: false, field: "categoryId", message: "出場する部を選んでください" };

  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if ([...note].length > ENTRY_NOTE_MAX) return { ok: false, field: "note", message: `備考は${ENTRY_NOTE_MAX}文字以内で入力してください` };

  return { ok: true, value: { teamName, categoryId, note: note || null } };
}
