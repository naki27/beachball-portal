import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/lib/api/csrf";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/auth/request", { method: "POST", headers });
}

describe("POST の Origin の検査（§9.2）", () => {
  it("Origin のホストが Host と同じなら通る（request.url とは比べない）", () => {
    expect(isSameOrigin(req({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }))).toBe(true);
    expect(isSameOrigin(req({ host: "entry.example.org", origin: "https://entry.example.org" }))).toBe(true);
  });

  it("前段があれば x-forwarded-host と比べる", () => {
    expect(isSameOrigin(req({ host: "internal:8080", "x-forwarded-host": "entry.example.org", origin: "https://entry.example.org" }))).toBe(true);
  });

  it("別のサイトからは拒否。Origin も Referer もなければ拒否", () => {
    expect(isSameOrigin(req({ host: "entry.example.org", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(req({ host: "entry.example.org", origin: "null" }))).toBe(false);
    expect(isSameOrigin(req({ host: "entry.example.org" }))).toBe(false);
    expect(isSameOrigin(req({ host: "entry.example.org", referer: "https://entry.example.org/login" }))).toBe(true);
    expect(isSameOrigin(req({ host: "entry.example.org", referer: "https://evil.example/" }))).toBe(false);
  });
});
