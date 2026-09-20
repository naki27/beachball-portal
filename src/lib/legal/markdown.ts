// プライバシーポリシー・利用規約（設計書 §5.18）の文面を読むための、ごく小さなマークダウンの解釈
// docs/legal/*.md で使っている記法だけを扱う: 見出し（#・##）・段落・箇条書き（-・1.）・表・**強調**・[文字](URL)
// HTML のコメント（<!-- … -->）は画面に出さない（公開前の申し送りをファイルに残すため）

export type Inline =
  | { kind: "text"; value: string }
  | { kind: "strong"; value: string }
  | { kind: "link"; value: string; href: string };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: Inline[] }
  | { kind: "paragraph"; text: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] };

const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of source.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", value: source.slice(last, at) });
    if (m[1] !== undefined) out.push({ kind: "strong", value: m[1] });
    else out.push({ kind: "link", value: m[2], href: m[3] });
    last = at + m[0].length;
  }
  if (last < source.length) out.push({ kind: "text", value: source.slice(last) });
  return out.filter((i) => i.kind !== "text" || i.value !== "");
}

function cells(line: string): Inline[][] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => parseInline(c.trim()));
}

function isSeparator(line: string): boolean {
  return /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?$/.test(line);
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/<!--[\s\S]*?-->/g, "").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: parseInline(paragraph.join(" ")) });
    paragraph = [];
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trimEnd();
    if (line.trim() === "" || line.trim() === "---") {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: parseInline(heading[2]) });
      continue;
    }

    // 表（見出しの行 → 区切りの行 → 中身の行）
    if (line.startsWith("|") && isSeparator(lines[i + 1]?.trim() ?? "")) {
      flushParagraph();
      const head = cells(line);
      const rows: Inline[][][] = [];
      i += 1;
      while ((lines[i + 1] ?? "").trim().startsWith("|")) {
        i += 1;
        rows.push(cells(lines[i].trim()));
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !!numbered;
      const item = parseInline((bullet ?? numbered)![1]);
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "list" && previous.ordered === ordered) previous.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}
