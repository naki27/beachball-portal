import { describe, expect, it } from "vitest";
import { contentDispositionFor, newPublicKey, PUBLIC_DOCUMENT_PREFIX, shouldBePublic } from "@/lib/documents/publish";

// 大会資料の公開用ファイル（設計書 §5.9・C-02）の純粋な部分

describe("newPublicKey", () => {
  it("推測されにくいランダムな名前で、呼ぶたびに違う", () => {
    const a = newPublicKey();
    const b = newPublicKey();
    expect(a).toMatch(new RegExp(`^${PUBLIC_DOCUMENT_PREFIX}[0-9a-f]{32}\\.pdf$`));
    expect(a).not.toBe(b);
  });
});

describe("contentDispositionFor", () => {
  it("ブラウザ内で開き、保存時の名前はタイトル（UTF-8 を percent-encoding・ASCII だけ）", () => {
    const value = contentDispositionFor("第10回 大会冊子");
    expect(value).toBe(`inline; filename*=UTF-8''${encodeURIComponent("第10回 大会冊子.pdf")}`);
    expect(/^[\x20-\x7e]+$/.test(value)).toBe(true);
  });

  it("ファイル名に使えない文字は空白にし、空なら document", () => {
    expect(contentDispositionFor('a/b\\c:d*e?f"g<h>i|j')).toContain(encodeURIComponent("a b c d e f g h i j.pdf"));
    expect(contentDispositionFor("   ")).toContain(encodeURIComponent("document.pdf"));
    expect(decodeURIComponent(contentDispositionFor("あ".repeat(200)).split("''")[1]).length).toBe(84);
  });
});

describe("shouldBePublic", () => {
  const live = { status: "open", deletedAt: null };
  it("資料が公開・未削除で、大会が準備中でも削除済みでもないときだけ", () => {
    expect(shouldBePublic({ isPublic: true, deletedAt: null }, live)).toBe(true);
    expect(shouldBePublic({ isPublic: true, deletedAt: null }, { status: "closed", deletedAt: null })).toBe(true);
    expect(shouldBePublic({ isPublic: false, deletedAt: null }, live)).toBe(false);
    expect(shouldBePublic({ isPublic: true, deletedAt: new Date() }, live)).toBe(false);
    expect(shouldBePublic({ isPublic: true, deletedAt: null }, { status: "draft", deletedAt: null })).toBe(false);
    expect(shouldBePublic({ isPublic: true, deletedAt: null }, { status: "open", deletedAt: new Date() })).toBe(false);
    expect(shouldBePublic({ isPublic: true, deletedAt: null }, null)).toBe(false);
  });
});
