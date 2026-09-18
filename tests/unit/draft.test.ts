import { describe, expect, it } from "vitest";
import {
  clearAllDrafts,
  DRAFT_TTL_MS,
  type DraftStorage,
  draftKey,
  purgeExpiredDrafts,
  readDraft,
  removeDraft,
  writeDraft,
} from "@/lib/draft";

// localStorage の代わり（Map）
function fakeStorage(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

const T0 = Date.parse("2026-04-01T00:00:00Z");
const KEY = draftKey({ associationId: "a1", screen: "entry-form", targetId: "t1" });

describe("一時保存（§4.3「通信」）", () => {
  it("キーは協会・画面・大会の ID から作る", () => {
    expect(KEY).toBe("draft:a1:entry-form:t1");
    expect(draftKey({ associationId: "a1", screen: "team-form" })).toBe("draft:a1:team-form");
  });

  it("書いたものを読める。ないときは null", () => {
    const s = fakeStorage();
    expect(readDraft(s, KEY, T0)).toBeNull();
    writeDraft(s, KEY, { name: "山田", birthDate: "1965-05-03" }, T0);
    expect(readDraft(s, KEY, T0 + 1000)).toEqual({ name: "山田", birthDate: "1965-05-03" });
  });

  it("7 日を過ぎたものは読めず、そのとき消える", () => {
    const s = fakeStorage();
    writeDraft(s, KEY, "x", T0);
    expect(readDraft(s, KEY, T0 + DRAFT_TTL_MS)).toBe("x");
    expect(readDraft(s, KEY, T0 + DRAFT_TTL_MS + 1)).toBeNull();
    expect(s.map.has(KEY)).toBe(false);
  });

  it("壊れた値は読めず、消える", () => {
    const s = fakeStorage();
    s.setItem(KEY, "{not json");
    expect(readDraft(s, KEY, T0)).toBeNull();
    expect(s.map.has(KEY)).toBe(false);
    s.setItem(KEY, JSON.stringify({ value: "no savedAt" }));
    expect(readDraft(s, KEY, T0)).toBeNull();
  });

  it("送信の完了で 1 つ消す。ログアウトで draft: のものだけ全部消す", () => {
    const s = fakeStorage();
    writeDraft(s, KEY, "a", T0);
    writeDraft(s, draftKey({ associationId: "a1", screen: "team-form" }), "b", T0);
    s.setItem("theme", "light");
    removeDraft(s, KEY);
    expect(s.map.has(KEY)).toBe(false);
    expect(clearAllDrafts(s)).toBe(1);
    expect([...s.map.keys()]).toEqual(["theme"]);
  });

  it("期限切れだけをまとめて消せる", () => {
    const s = fakeStorage();
    writeDraft(s, "draft:old", "a", T0 - DRAFT_TTL_MS - 1);
    writeDraft(s, "draft:new", "b", T0);
    expect(purgeExpiredDrafts(s, T0)).toBe(1);
    expect([...s.map.keys()]).toEqual(["draft:new"]);
  });
});
