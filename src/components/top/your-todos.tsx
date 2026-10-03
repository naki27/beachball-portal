import Link from "next/link";
import { Card } from "@/components/ui/layout";

export type TodoItem = { key: string; text: string; href: string };

// 「あなたのやること」（設計書 §5.17「表示」）。ログイン中の人だけ、ブロックの上に出す。並び替え・非表示の対象外
// 自分が代表を務めるチーム・個人登録について出す（年度更新・受付中の大会への申込など）
// やることがなければ枠ごと出さない
export function YourTodos({ items }: { items: TodoItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="your-todos">
      <Card tone="soft" className="flex flex-col gap-3 border-2 border-primary">
        <h2 id="your-todos" className="flex items-center gap-2 text-lg font-bold">
          <span aria-hidden="true" className="h-5 w-1 rounded-full bg-primary" />
          あなたのやること
        </h2>
        <ul className="bb-stagger flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="bb-pressable flex min-h-12 items-center rounded-md bg-background px-3 font-semibold text-primary no-underline shadow-sm hover:bg-brand-100"
              >
                {item.text}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
