import { describe, expect, it } from "vitest";
import { SITE_NAME } from "@/lib/site";

describe("SITE_NAME", () => {
  it("仮の名前が設定されている", () => {
    expect(SITE_NAME).toBe("ビーチボール大会申し込みサイト");
  });

  it("画面に出さない語を含まない（設計書 §4.4）", () => {
    expect(SITE_NAME).not.toMatch(/エントリー|（仮）|\(仮\)/);
  });

  it("pnpm test は TZ=UTC と TZ=Asia/Tokyo で流す", () => {
    if (process.env.TZ !== undefined) {
      expect(["UTC", "Asia/Tokyo"]).toContain(process.env.TZ);
    }
  });
});
