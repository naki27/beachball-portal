import Link from "next/link";

export type TodoItem = { key: string; text: string; href: string };

// 「あなたのやること」（設計書 §5.17「表示」）。ログイン中の人だけ、ブロックの上に出す。並び替え・非表示の対象外
// 自分が代表を務めるチーム・個人登録について出す（年度更新・受付中の大会への申込など。中身は B-06・D 系のタスク）
// やることがなければ枠ごと出さない
export function YourTodos({ items }: { items: TodoItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="your-todos" className="flex flex-col gap-3 rounded-md border-2 border-primary px-4 py-4">
      <h2 id="your-todos" className="text-lg font-bold">
        あなたのやること
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key}>
            <Link href={item.href} className="font-semibold underline underline-offset-2">
              {item.text}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
