// 申込の進み具合（設計書 §4.5「入力 → 確認 → 完了」の現在位置）。3 ページで同じ部品を使う
const STEPS = [
  { key: "input", label: "入力" },
  { key: "confirm", label: "確認" },
  { key: "done", label: "完了" },
] as const;

export type EntryStep = (typeof STEPS)[number]["key"];

export function EntrySteps({ current }: { current: EntryStep }) {
  const index = STEPS.findIndex((step) => step.key === current);
  return (
    <nav aria-label="申し込みの進み具合">
      <ol className="flex items-center gap-2">
        {STEPS.map((step, i) => (
          <li key={step.key} className="flex items-center gap-2">
            <span
              aria-current={i === index ? "step" : undefined}
              className={`flex min-h-10 items-center rounded-md px-3 font-semibold ${
                i === index ? "bg-primary text-on-primary" : i < index ? "bg-surface text-foreground" : "text-muted"
              }`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 ? <span aria-hidden="true">→</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
