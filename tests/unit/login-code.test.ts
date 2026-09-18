import { describe, expect, it } from "vitest";
import { cookieAttributes, loginAttemptCookieName, sessionCookieName } from "@/lib/auth/cookies";
import { safeNext } from "@/lib/auth/login-client";
import { codeHashMatches, generateAttemptId, generateCode, hashAttemptId, hashCode } from "@/lib/auth/login-code";
import { normalizeCodeInput, normalizeEmail } from "@/lib/auth/login-input";

describe("確認番号（§9.2）", () => {
  it("6 桁の数字（先頭 0 あり）", () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it("HMAC は鍵と試行 ID で変わり、同じ組では一致する", () => {
    const a = generateAttemptId();
    const b = generateAttemptId();
    expect(a).not.toBe(b);
    expect(hashAttemptId(a)).toMatch(/^[0-9a-f]{64}$/);
    const h = hashCode("key", a, "012345");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCode("key", a, "012345")).toBe(h);
    expect(hashCode("key", b, "012345")).not.toBe(h);
    expect(hashCode("other", a, "012345")).not.toBe(h);
    expect(codeHashMatches("key", a, "012345", h)).toBe(true);
    expect(codeHashMatches("key", a, "012346", h)).toBe(false);
    expect(codeHashMatches("key", a, "012345", "00")).toBe(false);
  });

  it("入力の 6 桁は全角・空白・ハイフンを取り除く", () => {
    expect(normalizeCodeInput("１２３４５６")).toBe("123456");
    expect(normalizeCodeInput(" 123 456 ")).toBe("123456");
    expect(normalizeCodeInput("123-456")).toBe("123456");
    expect(normalizeCodeInput("12345")).toBeNull();
    expect(normalizeCodeInput("1234567")).toBeNull();
    expect(normalizeCodeInput("abc123")).toBeNull();
  });
});

describe("メールアドレスの形式（§5.1）", () => {
  it("小文字にそろえ、形が違えば null", () => {
    expect(normalizeEmail("  Taro@Example.com ")).toBe("taro@example.com");
    expect(normalizeEmail("taro@example")).toBeNull();
    expect(normalizeEmail("taro")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("a b@example.com")).toBeNull();
  });
});

describe("Cookie の名前と属性（§9.2 v0.9.4）", () => {
  it("http のときは __Host- も Secure も付けない", () => {
    process.env.APP_BASE_URL = "http://localhost:3000";
    expect(loginAttemptCookieName()).toBe("login_attempt");
    expect(sessionCookieName()).toBe("session");
    expect(cookieAttributes(60)).toEqual({ httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 60 });
  });

  it("https のときだけ __Host- と Secure", () => {
    process.env.APP_BASE_URL = "https://entry.example.org";
    expect(loginAttemptCookieName()).toBe("__Host-login_attempt");
    expect(sessionCookieName()).toBe("__Host-session");
    expect(cookieAttributes(60).secure).toBe(true);
    process.env.APP_BASE_URL = "http://localhost:3000";
  });
});

describe("戻り先（§5.2）", () => {
  it("同じサイト内の相対パスだけ", () => {
    expect(safeNext("/sawara/admin?x=1")).toBe("/sawara/admin?x=1");
    expect(safeNext("//evil.example")).toBeNull();
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext("/\\evil.example")).toBeNull();
    expect(safeNext("")).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});
