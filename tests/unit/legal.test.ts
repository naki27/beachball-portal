import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnv } from "@/db/env";
import { legalSource } from "@/lib/legal/documents";
import { parseInline, parseMarkdown } from "@/lib/legal/markdown";
import { SITE_NAME } from "@/lib/site";

// プライバシーポリシー・利用規約（設計書 §5.18）の文面と、その表示のためのマークダウンの解釈
const read = (slug: string) =>
  readFileSync(path.join(process.cwd(), "docs", "legal", `${slug}.md`), "utf8");

describe("マークダウンの解釈", () => {
  it("見出し・段落・箇条書き・表を読む", () => {
    const blocks = parseMarkdown(
      [
        "# 題",
        "",
        "本文の行。",
        "続きの行。",
        "",
        "## 小見出し",
        "- 一つめ",
        "- 二つめ",
        "",
        "1. 手順の一つめ",
        "2. 手順の二つめ",
        "",
        "| 見出し | 説明 |",
        "|---|---|",
        "| あ | い |",
        "| う | え |",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "heading", "list", "list", "table"]);
    expect(blocks[1]).toMatchObject({ text: [{ kind: "text", value: "本文の行。 続きの行。" }] });
    expect(blocks[3]).toMatchObject({ ordered: false, items: [[{ value: "一つめ" }], [{ value: "二つめ" }]] });
    expect(blocks[4]).toMatchObject({ ordered: true });
    const table = blocks[5];
    if (table.kind !== "table") throw new Error("表ではありません");
    expect(table.head).toHaveLength(2);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1][1]).toEqual([{ kind: "text", value: "え" }]);
  });

  it("強調とリンクを読み、HTML のコメントは出さない", () => {
    expect(parseInline("生年月日は、**資格の確認**と[お問い合わせ](/contact)に使います")).toEqual([
      { kind: "text", value: "生年月日は、" },
      { kind: "strong", value: "資格の確認" },
      { kind: "text", value: "と" },
      { kind: "link", value: "お問い合わせ", href: "/contact" },
      { kind: "text", value: "に使います" },
    ]);
    const blocks = parseMarkdown("<!-- 公開の前に確かめること\n  - 専門家の確認 -->\n\n見える文。\n");
    expect(blocks).toEqual([{ kind: "paragraph", text: [{ kind: "text", value: "見える文。" }] }]);
  });
});

describe("文面（docs/legal）", () => {
  it("サイト名は直書きせず、置き換えで入れる", () => {
    for (const slug of ["privacy", "terms"]) {
      const source = read(slug);
      expect(source).toContain("{{SITE_NAME}}");
      expect(source).not.toContain(SITE_NAME);
      expect(legalSource(source)).toContain(SITE_NAME);
      expect(legalSource(source)).not.toContain("{{SITE_NAME}}");
    }
  });

  it("版は TERMS_VERSION と同じ値で、埋めていない箇所がない", () => {
    loadEnv();
    const version = process.env.TERMS_VERSION?.trim();
    expect(version).toBeTruthy();
    for (const slug of ["privacy", "terms"]) {
      const source = read(slug);
      expect(source).toContain(`版: ${version}`);
      expect(source).not.toContain("【要記入");
      expect(source).not.toContain("【要確認");
    }
  });

  it("画面に出す文面は、題名の見出しと本文になる", () => {
    for (const slug of ["privacy", "terms"]) {
      const blocks = parseMarkdown(legalSource(read(slug)));
      expect(blocks[0]).toMatchObject({ kind: "heading", level: 1 });
      expect(blocks.length).toBeGreaterThan(10);
    }
  });
});
