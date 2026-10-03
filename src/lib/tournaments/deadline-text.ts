import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import { daysUntilDeadline } from "@/lib/deadline";

// 締切の見せ方（設計書 §5.6「9月30日（水）まで　あと5日」）。画面の文言は 1 か所にまとめる
// 締切の瞬間（23:59:59）は日本時間の年月日に戻してから出す。残り日数の計算は deadline.ts

export function deadlineText(deadline: Date, now: Date = new Date()): string {
  const date = formatDateWithWeekday(todayInTokyo(deadline));
  const left = daysUntilDeadline(deadline, now);
  if (left < 0) return `${date}に締め切りました`;
  if (left === 0) return `${date}まで　今日までです`;
  return `${date}まで　あと${left}日`;
}

// 締切の切迫ぐあい（設計書 §4.5「あと3日」以内は橙、当日は赤）。色の名前ではなく意味を返す
export type DeadlineTone = "past" | "today" | "soon" | "normal";

export function deadlineTone(deadline: Date, now: Date = new Date()): DeadlineTone {
  const left = daysUntilDeadline(deadline, now);
  if (left < 0) return "past";
  if (left === 0) return "today";
  if (left <= 3) return "soon";
  return "normal";
}
