import { afterEach, describe, expect, it } from "vitest";
import {
  cookieAttributes,
  cookiePrefix,
  loginAttemptCookieName,
  sessionCookieName,
} from "@/lib/auth/cookies";

// Cookie の名前と属性（設計書 §9.2・X-01）。本番（https）だけ __Host- と Secure を付ける
// 判断は APP_BASE_URL の 1 か所だけ（src/lib/auth/cookies.ts）

const original = process.env.APP_BASE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = original;
});

describe("本番（https）", () => {
  it("__Host- と Secure が付く", () => {
    process.env.APP_BASE_URL = "https://portal.fukuoka-city-beachball.org";
    expect(cookiePrefix()).toBe("__Host-");
    expect(sessionCookieName()).toBe("__Host-session");
    expect(loginAttemptCookieName()).toBe("__Host-login_attempt");
    // __Host- の条件（Secure・Path=/・Domain なし）を満たす
    expect(cookieAttributes(600)).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  });
});

describe("ローカル（http://localhost）", () => {
  it("__Host- も Secure も付かない（WebKit などが受け付けないため）", () => {
    process.env.APP_BASE_URL = "http://localhost:3000";
    expect(cookiePrefix()).toBe("");
    expect(sessionCookieName()).toBe("session");
    expect(cookieAttributes(600).secure).toBe(false);
  });

  it("APP_BASE_URL がなくても付かない", () => {
    delete process.env.APP_BASE_URL;
    expect(cookiePrefix()).toBe("");
    expect(cookieAttributes(600).secure).toBe(false);
  });
});
