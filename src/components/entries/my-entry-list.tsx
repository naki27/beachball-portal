import Link from "next/link";
import { formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import type { MyEntry } from "@/lib/entries/my-entries";

// マイページの申込の一覧（設計書 §5.3）。大会名・部・チーム名・状態・締切
export function MyEntryList({ slug, title, entries, now }: { slug: string; title: string; entries: MyEntry[]; now: Date }) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">{title}</h3>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li key={entry.entryId}>
            <Link
              href={`/${slug}/entries/${entry.entryId}`}
              className="flex min-h-12 flex-col justify-center rounded-md border border-border px-4 py-2 no-underline hover:bg-surface"
            >
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
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
