import { describe, expect, it } from "vitest";
import {
  checkPdf,
  DOC_MAX_BYTES,
  DOC_TITLE_MAX,
  formatFileSize,
  isDocType,
  parseDocumentInput,
} from "@/lib/documents/document-input";
import { contentDisposition, newDocumentPublicKey } from "@/lib/documents/keys";

// 大会資料の入力とファイルの検証（設計書 §5.9・C-01）
// 形式は PDF だけ。**拡張子だけ .pdf にした画像**と 10 MB 超は受け付けない

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);
// PNG のシグネチャ（拡張子だけ .pdf にしたときに止められるか）
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const file = (over: Partial<{ name: string; contentType: string; bytes: Uint8Array }> = {}) => ({
  name: "大会冊子.pdf",
  contentType: "application/pdf",
  bytes: pdf(),
  ...over,
});

describe("ファイルの検証", () => {
  it("PDF は受け付ける（Content-Type に charset が付いていても）", () => {
    expect(checkPdf(file())).toEqual({ ok: true });
    expect(checkPdf(file({ contentType: "application/pdf; charset=binary" }))).toEqual({ ok: true });
    expect(checkPdf(file({ name: "PROGRAM.PDF" }))).toEqual({ ok: true });
  });

  it("拡張子だけ .pdf にした画像は受け付けない", () => {
    const result = checkPdf(file({ bytes: png() }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("PDF として読めない");
  });

  it("拡張子が .pdf でないファイル・Content-Type が違うファイルは受け付けない", () => {
    expect(checkPdf(file({ name: "大会冊子.png" })).ok).toBe(false);
    expect(checkPdf(file({ contentType: "image/png" })).ok).toBe(false);
  });

  it("10 MB を超えるファイルは受け付けない（ちょうど 10 MB は通す）", () => {
    const head = pdf();
    const exact = new Uint8Array(DOC_MAX_BYTES);
    exact.set(head, 0);
    expect(checkPdf(file({ bytes: exact })).ok).toBe(true);

    const over = new Uint8Array(DOC_MAX_BYTES + 1);
    over.set(head, 0);
    const result = checkPdf(file({ bytes: over }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("10 MB");
  });

  it("空のファイルは受け付けない", () => {
    expect(checkPdf(file({ bytes: new Uint8Array() })).ok).toBe(false);
  });
});

describe("資料の入力", () => {
  const input = (over: Record<string, unknown> = {}) => ({ docType: "大会冊子", title: "大会冊子", sortOrder: "100", ...over });

  it("種別・タイトル・並び順・公開を読む", () => {
    const result = parseDocumentInput(input({ isPublic: "true" }));
    expect(result).toEqual({ ok: true, value: { docType: "大会冊子", title: "大会冊子", isPublic: true, sortOrder: 100 } });
  });

  it("チェックの外れた公開は非公開にする", () => {
    const result = parseDocumentInput(input({ isPublic: "false" }));
    expect(result.ok && result.value.isPublic).toBe(false);
    const missing = parseDocumentInput(input());
    expect(missing.ok && missing.value.isPublic).toBe(false);
    const checked = parseDocumentInput(input({ isPublic: "on" }));
    expect(checked.ok && checked.value.isPublic).toBe(true);
  });

  it("種別が表にないものは受け付けない", () => {
    expect(parseDocumentInput(input({ docType: "写真" }))).toMatchObject({ ok: false, field: "docType" });
    expect(isDocType("組み合わせ")).toBe(true);
    expect(isDocType("写真")).toBe(false);
  });

  it("タイトルは必須で、長すぎるものは受け付けない", () => {
    expect(parseDocumentInput(input({ title: "  " }))).toMatchObject({ ok: false, field: "title" });
    expect(parseDocumentInput(input({ title: "あ".repeat(DOC_TITLE_MAX + 1) }))).toMatchObject({ ok: false, field: "title" });
    expect(parseDocumentInput(input({ title: "あ".repeat(DOC_TITLE_MAX) })).ok).toBe(true);
  });

  it("並び順は数だけ。空欄は 0", () => {
    expect(parseDocumentInput(input({ sortOrder: "あ" }))).toMatchObject({ ok: false, field: "sortOrder" });
    expect(parseDocumentInput(input({ sortOrder: "-1" }))).toMatchObject({ ok: false, field: "sortOrder" });
    const empty = parseDocumentInput(input({ sortOrder: "" }));
    expect(empty.ok && empty.value.sortOrder).toBe(0);
  });
});

describe("公開用の名前", () => {
  it("大会や協会の ID を含まない、推測されにくい名前になる", () => {
    const a = newDocumentPublicKey();
    const b = newDocumentPublicKey();
    expect(a).toMatch(/^documents\/[0-9a-f]{32}\.pdf$/);
    expect(a).not.toBe(b);
  });

  it("保存するときの名前はブラウザで開ける形にする", () => {
    expect(contentDisposition("組み合わせ表")).toBe("inline; filename*=UTF-8''%E7%B5%84%E3%81%BF%E5%90%88%E3%82%8F%E3%81%9B%E8%A1%A8.pdf");
    // パスに使えない文字は落とす
    expect(contentDisposition("A/B")).toContain("A_B");
  });
});

describe("大きさの表示", () => {
  it("読める形にする", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
