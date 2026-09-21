import type { ReactNode } from "react";

/*
  画面の器（§4.3）。幅・余白・面の出し方をここだけで決める。
  ページ側で `max-w-…` や `px-…` を直書きしない（PC 対応をまとめて直せるように）。
*/

export type PageWidth = "narrow" | "wide" | "full";
export type Gap = "sm" | "md" | "lg" | "xl";

// narrow: 入力と読み物（1 行が長くなりすぎない）／wide: 一覧・ダッシュボード／full: 管理画面の表
const WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: "max-w-xl lg:max-w-2xl",
  wide: "max-w-5xl",
  full: "max-w-7xl",
};

const GAP_CLASS: Record<Gap, string> = {
  sm: "gap-4",
  md: "gap-6",
  lg: "gap-6 sm:gap-8",
  xl: "gap-8 sm:gap-10",
};

// ページの本文。横幅と左右・上下の余白は画面の大きさで変える
export function PageMain({
  width = "narrow",
  gap = "md",
  className = "",
  children,
}: {
  width?: PageWidth;
  gap?: Gap;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10 ${WIDTH_CLASS[width]} ${GAP_CLASS[gap]} ${className}`}
    >
      {children}
    </main>
  );
}

// ページの見出し。tone="hero" は色の付いた面（トップ・大会の入口など、気持ちを上げたい場所だけ）
export function PageHeader({
  title,
  lead,
  eyebrow,
  actions,
  tone = "plain",
  headingLevel = 1,
  className = "",
}: {
  title: ReactNode;
  lead?: ReactNode;
  // 見出しの上の小さな文字（大会名・チーム名など、今どこにいるか）
  eyebrow?: ReactNode;
  actions?: ReactNode;
  tone?: "plain" | "hero";
  // ページの見出しは h1（既定）。ページの中の見出しとして使うときだけ下げる
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const hero = tone === "hero";
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={
        hero
          ? `bb-rise-in flex flex-col gap-3 rounded-lg px-5 py-6 text-on-primary shadow-md sm:px-7 sm:py-8 ${className}`
          : `flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between ${className}`
      }
      style={hero ? { backgroundImage: "var(--gradient-hero)" } : undefined}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? (
          <p className={`text-sm font-semibold ${hero ? "text-brand-100" : "text-muted"}`}>{eyebrow}</p>
        ) : null}
        <Heading className={hero ? "text-2xl font-bold sm:text-3xl" : "text-2xl font-bold"}>{title}</Heading>
        {lead ? <p className={hero ? "text-brand-50" : "text-muted"}>{lead}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const CARD_TONE = {
  plain: "border-border bg-background",
  soft: "border-brand-200 bg-primary-soft",
  accent: "border-accent-200 bg-accent-soft",
  warning: "border-warning bg-warning-surface",
  danger: "border-danger bg-danger-surface",
} as const;
export type CardTone = keyof typeof CARD_TONE;

// 面（カード）。一覧の 1 件・まとまった情報に使う。interactive はリンクになっているカード（マウスで浮く）
export function Card({
  tone = "plain",
  interactive = false,
  className = "",
  children,
}: {
  tone?: CardTone;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border p-4 shadow-sm sm:p-5 ${CARD_TONE[tone]} ${interactive ? "bb-liftable" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

// 見出しの付いたまとまり。見出しは h2。id を付けると、ほかの画面から飛んで来られる
export function Section({
  title,
  id,
  description,
  actions,
  className = "",
  children,
}: {
  title: ReactNode;
  id?: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-3 ${className}`} id={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="flex items-center gap-2 text-lg font-bold">
          <span aria-hidden="true" className="h-5 w-1 rounded-full bg-brand" />
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
      {children}
    </section>
  );
}

// 一覧の上の道具立て（絞り込み・並び替え・登録ボタン）。PC では 1 行、スマホでは折り返す
export function Toolbar({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 ${className}`}
    >
      {children}
    </div>
  );
}

// 主要操作の置き場。スマホでは画面の下に貼り付き（サムゾーン・§4.3）、PC では本文の中に収める
export function ActionBar({
  sticky = true,
  className = "",
  children,
}: {
  sticky?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-2 sm:flex-row sm:items-center ${
        sticky
          ? "sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

const BADGE_TONE = {
  neutral: "border-border-strong bg-surface text-muted",
  brand: "border-brand-300 bg-primary-soft text-primary-strong",
  accent: "border-accent-300 bg-accent-soft text-accent-strong",
  success: "border-brand-300 bg-success-surface text-success",
  warning: "border-warning bg-warning-surface text-warning",
  danger: "border-danger bg-danger-surface text-danger",
} as const;
export type BadgeTone = keyof typeof BADGE_TONE;

// 小さな印（状態・区分）。色だけに頼らず、必ず文字を入れる（§4.5 原則 2）
export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      // max-w-full: 文字サイズを大きくした端末（150%・200%）で、長い文言が器からはみ出さないように折り返す（§12「動作確認の範囲」）
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${BADGE_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// 中身がないときの表示。「ない」だけで終わらせず、次にできることを出す
export function EmptyState({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {description ? <p className="text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
