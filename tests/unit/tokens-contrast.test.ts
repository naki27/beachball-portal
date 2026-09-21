import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 色のコントラスト比（設計書 §4.3「検証」・§12「動作確認の範囲」・U-06）。
// tokens.css に書いた比率が、値を変えたときに崩れないようにここで数える。
// 文字は 4.5:1 以上、枠線・印などの文字でないものは 3:1 以上（WCAG 2.1 AA）

const CSS = readFileSync(new URL("../../src/app/tokens.css", import.meta.url), "utf8");

// :root の変数を読む。var(--x) は 1 段ずつたどる
function tokens(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of CSS.split("\n")) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

const TOKENS = tokens();

function color(name: string): string {
  let value = TOKENS.get(name);
  for (let i = 0; value && i < 5; i++) {
    const ref = value.match(/^var\((--[a-z0-9-]+)\)$/i);
    if (!ref) break;
    value = TOKENS.get(ref[1]);
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} が 6 桁の色ではない: ${value}`);
  return value;
}

function luminance(hex: string): number {
  const parts = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = parts.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const ratio = (a: string, b: string) => contrast(color(a), color(b));

describe("配色のコントラスト比（tokens.css）", () => {
  it("文字と背景は 4.5:1 以上", () => {
    // 本文・補足（白い面の上）
    expect(ratio("--color-foreground", "--color-background")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-muted", "--color-background")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-muted", "--color-surface")).toBeGreaterThanOrEqual(4.5);
    // 主要操作・二次の操作（塗りつぶしのボタンの白文字）
    expect(ratio("--color-on-primary", "--color-primary")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-on-primary", "--color-primary-strong")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-on-primary", "--color-accent")).toBeGreaterThanOrEqual(4.5);
    // 状態の文字（それぞれの薄い面の上）
    expect(ratio("--color-danger", "--color-danger-surface")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-warning", "--color-warning-surface")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-success", "--color-success-surface")).toBeGreaterThanOrEqual(4.5);
    expect(ratio("--color-foreground", "--color-highlight")).toBeGreaterThanOrEqual(4.5);
  });

  it("枠線など文字でないものは 3:1 以上", () => {
    // 入力欄・押せるものの枠
    expect(ratio("--color-border-strong", "--color-background")).toBeGreaterThanOrEqual(3);
    expect(ratio("--color-focus", "--color-background")).toBeGreaterThanOrEqual(3);
  });

  it("審判級（K-01）は、文字 4.5:1・枠 3:1 以上", () => {
    for (const grade of ["a", "b", "c"] as const) {
      expect(ratio(`--referee-${grade}`, `--referee-${grade}-surface`), `${grade} の文字`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(`--referee-${grade}-border`, "--color-background"), `${grade} の枠`).toBeGreaterThanOrEqual(3);
      // 丸い印は、塗りか輪郭のどちらかで面と 3:1 以上の差が要る（白の印は輪郭だけが頼り）
      const mark = Math.max(ratio(`--referee-${grade}-mark`, `--referee-${grade}-surface`), ratio(`--referee-${grade}-border`, `--referee-${grade}-surface`));
      expect(mark, `${grade} の丸い印`).toBeGreaterThanOrEqual(3);
    }
  });

  it("#42B036（指定のメインカラー）は白文字に足りないので、塗りつぶしには --brand-700 以上を使う", () => {
    expect(ratio("--color-on-primary", "--brand-500")).toBeLessThan(4.5);
    expect(ratio("--color-on-primary", "--brand-700")).toBeGreaterThanOrEqual(4.5);
  });
});
