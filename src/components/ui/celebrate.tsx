import type { ReactNode } from "react";
import { CheckIcon } from "./check-icon";

/*
  節目の演出（ADR 0028・設計書 §4.5 原則 1 の例外）。
  **申込の完了と、年度更新の申告の完了だけ**に使う。ほかの画面では使わない。

  - 紙吹雪は 1 回だけ落ちて消える。繰り返さない
  - OS の「視差効果を減らす」が ON なら紙吹雪そのものを出さない（globals.css の .bb-confetti）。
    チェックと文字は残るので、動きを見なくても用が足りる（原則 2）
  - 紙吹雪は飾りなので読み上げの対象にしない。位置・色・遅れは固定にして、
    サーバーとブラウザで食い違わないようにする（乱数を使わない）
*/

const PIECES = [
  { left: "6%", delay: 0, color: "var(--brand-500)", size: 10 },
  { left: "14%", delay: 120, color: "var(--accent-400)", size: 7 },
  { left: "23%", delay: 60, color: "var(--brand-300)", size: 12 },
  { left: "31%", delay: 200, color: "var(--accent-500)", size: 8 },
  { left: "40%", delay: 40, color: "var(--brand-400)", size: 9 },
  { left: "48%", delay: 160, color: "var(--accent-300)", size: 11 },
  { left: "57%", delay: 90, color: "var(--brand-500)", size: 7 },
  { left: "65%", delay: 240, color: "var(--accent-400)", size: 10 },
  { left: "73%", delay: 30, color: "var(--brand-300)", size: 8 },
  { left: "81%", delay: 180, color: "var(--accent-500)", size: 12 },
  { left: "89%", delay: 100, color: "var(--brand-400)", size: 9 },
  { left: "95%", delay: 220, color: "var(--accent-300)", size: 7 },
] as const;

export function Celebrate({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-brand-300 bg-success-surface px-4 py-8 shadow-sm">
      <div aria-hidden="true" className="bb-confetti pointer-events-none absolute inset-x-0 top-0 h-full">
        {PIECES.map((piece) => (
          <span
            key={piece.left}
            className="bb-confetti-piece absolute top-0 block rounded-sm"
            style={{
              left: piece.left,
              width: `${piece.size}px`,
              height: `${piece.size}px`,
              background: piece.color,
              animationDelay: `${piece.delay}ms`,
            }}
          />
        ))}
      </div>
      <div className="relative flex flex-col items-center gap-3 text-center">
        <span className="bb-pop flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary shadow-md">
          <CheckIcon className="size-8" />
        </span>
        <p role="status" className="text-xl font-bold">
          {title}
        </p>
        {children ? <div className="text-sm">{children}</div> : null}
      </div>
    </div>
  );
}
