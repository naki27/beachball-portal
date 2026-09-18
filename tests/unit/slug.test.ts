import { describe, expect, it } from "vitest";
import { classifySlug, redirectTargetFor, RESERVED_SLUGS, slugFromUrl } from "@/lib/slug";

describe("classifySlug（§5.14 の解決順 ①）", () => {
  it("予約語は協会の画面ではない", () => {
    for (const word of ["admin", "api", "login", "logout", "mypage", "platform", "invitations", "account", "auth", "me", "webhooks", "health", "privacy", "terms", "contact", "site-contact", "_next", "static"]) {
      expect(RESERVED_SLUGS.has(word)).toBe(true);
      expect(classifySlug(word)).toBe("reserved");
    }
  });

  it("英小文字・数字・ハイフンで 3〜30 文字だけが候補", () => {
    expect(classifySlug("sawara")).toBe("candidate");
    expect(classifySlug("abc")).toBe("candidate");
    expect(classifySlug("a".repeat(30))).toBe("candidate");
    expect(classifySlug("ab")).toBe("invalid");
    expect(classifySlug("a".repeat(31))).toBe("invalid");
    expect(classifySlug("Sawara")).toBe("invalid");
    expect(classifySlug("sawara_ku")).toBe("invalid");
    expect(classifySlug("早良")).toBe("invalid");
    expect(classifySlug("")).toBe("invalid");
  });
});

describe("redirectTargetFor（解決順 ③ の 308。パスと検索文字列を保つ）", () => {
  it("画面の URL", () => {
    expect(redirectTargetFor("/sawara-old", "sawara")).toBe("/sawara");
    expect(redirectTargetFor("/sawara-old/", "sawara")).toBe("/sawara/");
    expect(redirectTargetFor("/sawara-old/tournaments/abc?tab=entries&x=1", "sawara")).toBe(
      "/sawara/tournaments/abc?tab=entries&x=1",
    );
  });

  it("API の URL（/api/[slug]/…）", () => {
    expect(redirectTargetFor("http://localhost:3000/api/sawara-old/teams?q=%E5%B1%B1", "sawara")).toBe(
      "/api/sawara/teams?q=%E5%B1%B1",
    );
  });
});

describe("slugFromUrl（エラーページの戻り先）", () => {
  it("先頭の区切りが候補ならそれ、予約語・なしなら null", () => {
    expect(slugFromUrl("/sawara/admin?x=1")).toBe("sawara");
    expect(slugFromUrl("/api/sawara/teams")).toBe("sawara");
    expect(slugFromUrl("/")).toBeNull();
    expect(slugFromUrl("/login?next=%2Fsawara")).toBeNull();
    expect(slugFromUrl("/api/health")).toBeNull();
  });
});
