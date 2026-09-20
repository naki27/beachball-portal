import Link from "next/link";
import { formatDateWithWeekday } from "@/lib/date";
import type { PublicTournament } from "@/lib/public/tournaments";
import { deadlineText } from "@/lib/tournaments/deadline-text";

// 公開ページの大会の 1 件（設計書 §5.6・§4.2 #1・#6）。トップ・大会一覧で同じ見た目にする
// 選手の情報は出さない（この部品が受け取る PublicTournament にも入っていない）
export function TournamentCard({ slug, tournament, now }: { slug: string; tournament: PublicTournament; now: Date }) {
  return (
    <li>
      <Link
        href={`/${slug}/tournaments/${tournament.id}`}
        className="flex min-h-14 flex-col justify-center rounded-md border border-border px-4 py-3 no-underline hover:bg-surface"
      >
        <span className="font-semibold break-words">{tournament.name}</span>
        <span className="text-sm text-muted">
          {tournament.eventDate ? `${tournament.eventDate.year}年${formatDateWithWeekday(tournament.eventDate)}開催` : "開催日は未定"}
          {tournament.venue ? `・${tournament.venue}` : ""}
        </span>
        <span className="text-sm text-muted">{deadlineText(tournament.entryEndAt, now)}</span>
      </Link>
    </li>
  );
}
