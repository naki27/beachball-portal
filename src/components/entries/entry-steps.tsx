// 申込の進み具合（設計書 §4.5「入力 → 確認 → 完了」の現在位置）。3 ページで同じ部品を使う
// 終わった段階はチェック、いまの段階は色つきの丸、これからの段階は薄い丸。数字と文字も必ず出す（色だけに頼らない）
import { CheckIcon } from "@/components/ui/check-icon";

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
      {/* 文字サイズを大きくすると丸も文字も rem ぶん大きくなるので、1 行に収まらなければ折り返す（U-06） */}
      <ol className="flex flex-wrap items-center gap-y-2">
        {STEPS.map((step, i) => {
          const done = i < index;
          const now = i === index;
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-center last:flex-none">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 font-bold ${
                    now
                      ? "border-primary bg-primary text-on-primary shadow-ring"
                      : done
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border-strong text-muted"
                  }`}
                >
                  {done ? <CheckIcon className="size-5" animated={false} /> : i + 1}
                </span>
                <span
                  aria-current={now ? "step" : undefined}
                  className={`font-semibold ${now ? "text-primary" : done ? "text-foreground" : "text-muted"}`}
                >
                  {step.label}
                </span>
              </span>
              {i < STEPS.length - 1 ? (
                <span aria-hidden="true" className="mx-2 h-0.5 flex-1 rounded-full bg-border">
                  <span className={`block h-full rounded-full ${done ? "bb-grow w-full bg-primary" : "w-0"}`} />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
