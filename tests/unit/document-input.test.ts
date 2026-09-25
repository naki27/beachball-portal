import { describe, expect, it } from "vitest";
import { checkPdfUpload, formatBytes, MAX_DOCUMENT_BYTES, parseDocumentInput } from "@/lib/documents/document-input";

// 大会資料の検査（設計書 §5.9・C-01）。PDF 以外（拡張子だけ .pdf の画像を含む）と 10 MB 超は拒否

const pdfBytes = (size = 100) => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.7"));
  return bytes;
};
const pngBytes = () => {
  const bytes = new Uint8Array(100);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};
const check = (bytes: Uint8Array, contentType = "application/pdf") =>
  checkPdfUpload({ size: bytes.byteLength, contentType, head: bytes.subarray(0, 8) });

describe("checkPdfUpload（§5.9）", () => {
  it("PDF は通る（Content-Type に charset が付いていても・大文字でも）", () => {
    expect(check(pdfBytes())).toEqual({ ok: true });
    expect(check(pdfBytes(), "application/pdf; charset=binary")).toEqual({ ok: true });
    expect(check(pdfBytes(), "Application/PDF")).toEqual({ ok: true });
  });

  it("拡張子だけ .pdf に変えた画像（先頭が %PDF- でない）は拒否", () => {
    const result = check(pngBytes());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("中身が PDF ではありません");
  });

  it("Content-Type が PDF でなければ、中身が PDF でも拒否", () => {
    expect(check(pdfBytes(), "image/png").ok).toBe(false);
    expect(check(pdfBytes(), "application/octet-stream").ok).toBe(false);
    expect(check(pdfBytes(), "").ok).toBe(false);
  });

  it("10 MB を超えると拒否、ちょうど 10 MB は通る", () => {
    const head = pdfBytes().subarray(0, 8);
    expect(checkPdfUpload({ size: MAX_DOCUMENT_BYTES, contentType: "application/pdf", head })).toEqual({ ok: true });
    const over = checkPdfUpload({ size: MAX_DOCUMENT_BYTES + 1, contentType: "application/pdf", head });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toContain("10 MB");
  });

  it("空のファイルと、先頭が短すぎるファイルは拒否", () => {
    expect(check(new Uint8Array(0)).ok).toBe(false);
    expect(check(new TextEncoder().encode("%PD")).ok).toBe(false);
  });
});

describe("parseDocumentInput", () => {
  const valid = { docType: "大会冊子", title: " 第10回 大会冊子 ", isPublic: "true" };

  it("種別・タイトル（前後の空白は除く）・公開の 3 つを読む。並び順は省略できる", () => {
    expect(parseDocumentInput(valid)).toEqual({
      ok: true,
      value: { docType: "大会冊子", title: "第10回 大会冊子", isPublic: true, sortOrder: null },
    });
    expect(parseDocumentInput({ ...valid, isPublic: false, sortOrder: "3" })).toMatchObject({ ok: true, value: { isPublic: false, sortOrder: 3 } });
  });

  it("表にない種別・空のタイトル・長すぎるタイトルは欄名つきで拒否", () => {
    expect(parseDocumentInput({ ...valid, docType: "booklet" })).toMatchObject({ ok: false, field: "docType" });
    expect(parseDocumentInput({ ...valid, title: "   " })).toMatchObject({ ok: false, field: "title" });
    expect(parseDocumentInput({ ...valid, title: "あ".repeat(101) })).toMatchObject({ ok: false, field: "title" });
    expect(parseDocumentInput({ ...valid, title: "あ".repeat(100) })).toMatchObject({ ok: true });
  });

  it("公開するかどうかが読めなければ拒否（既定で公開にしない）", () => {
    expect(parseDocumentInput({ docType: "要項", title: "要項" })).toMatchObject({ ok: false, field: "isPublic" });
    expect(parseDocumentInput({ ...valid, isPublic: "yes" })).toMatchObject({ ok: false, field: "isPublic" });
  });

  it("並び順は 0〜9999 の整数だけ", () => {
    expect(parseDocumentInput({ ...valid, sortOrder: "-1" })).toMatchObject({ ok: false, field: "sortOrder" });
    expect(parseDocumentInput({ ...valid, sortOrder: "1.5" })).toMatchObject({ ok: false, field: "sortOrder" });
    expect(parseDocumentInput({ ...valid, sortOrder: "abc" })).toMatchObject({ ok: false, field: "sortOrder" });
    expect(parseDocumentInput({ ...valid, sortOrder: 0 })).toMatchObject({ ok: true, value: { sortOrder: 0 } });
  });
});

describe("formatBytes", () => {
  it("MB と KB で出す", () => {
    expect(formatBytes(1_258_291)).toBe("1.2 MB");
    expect(formatBytes(358_400)).toBe("350 KB");
    expect(formatBytes(10)).toBe("1 KB");
  });
});
