// CSV の書き方はここ 1 か所（設計書 §5.13）。**UTF-8 BOM 付き**（Excel で文字化けさせない）
// 改行・カンマ・引用符を含むセルは引用符で囲み、中の引用符は 2 つに重ねる
// 先頭が = + - @ のセルは、表計算が数式と解釈しないように ' を付ける（CSV インジェクション対策・§12）

export const CSV_BOM = "﻿";

const RISKY = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const escaped = RISKY.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  // 改行は CRLF（Excel が扱いやすい）
  return CSV_BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
