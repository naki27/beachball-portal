import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, toCsv } from "@/lib/export/csv";

// CSV の書き方（設計書 §5.13）
describe("CSV", () => {
  it("BOM 付きで、改行は CRLF", () => {
    const csv = toCsv([["氏名", "年齢"], ["早良 太郎", 51]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}氏名,年齢\r\n早良 太郎,51\r\n`);
  });

  it("カンマ・改行・引用符を含むセルは引用符で囲む", () => {
    expect(csvCell("早良, 太郎")).toBe('"早良, 太郎"');
    expect(csvCell('「"」を含む')).toBe('"「""」を含む"');
    expect(csvCell("1 行目\n2 行目")).toBe('"1 行目\n2 行目"');
    expect(csvCell(null)).toBe("");
  });

  it("数式と解釈されうるセルは無害にする", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-08012345678")).toBe("'-08012345678");
  });
});
