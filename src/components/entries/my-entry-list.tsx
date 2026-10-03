import Link from "next/link";
import { Card } from "@/components/ui/layout";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import type { MyEntry } from "@/lib/entries/my-entries";

// マイページの申込の一覧（設計書 §5.3）。大会名・部・チーム名・状態・締切
export function MyEntryList({ slug, title, entries, now }: { slug: string; title: string; entries: MyEntry[]; now: Date }) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="bb-stagger grid gap-2 md:grid-cols-2">
        {entries.map((entry) => (
          <li key={entry.entryId}>
            <Link href={`/${slug}/entries/${entry.entryId}`} className="block h-full no-underline">
              <Card interactive className="flex h-full flex-col justify-center gap-0.5 p-3 sm:p-4">
              <span className="font-semibold break-words">
                {entry.tournamentName}
                {entry.status === "cancelled" ? <span className="ml-2 text-sm font-normal text-muted">取り消し済み</span> : null}
              </span>
              <span className="text-sm text-muted break-words">
                {entry.categoryLabel}・{entry.teamName}
                {entry.status === "submitted"
                  ? entry.deadline.getTime() > now.getTime()
                    ? `・締切 ${formatDateWithWeekday(todayInTokyo(entry.deadline))}まで`
                    : "・締切は過ぎました"
                  : ""}
              </span>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
