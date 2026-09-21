import Link from "next/link";
import { Badge, Card } from "@/components/ui/layout";
import { formatDateWithWeekday } from "@/lib/date";
import type { PublicTournament } from "@/lib/public/tournaments";
import { type DeadlineTone, deadlineText, deadlineTone } from "@/lib/tournaments/deadline-text";

// 締切の色（§4.5「あと3日」以内は橙、当日は赤）。色だけに頼らず、文字（あと◯日／今日まで）も必ず出す
const TONE: Record<DeadlineTone, "neutral" | "brand" | "warning" | "danger"> = {
  past: "neutral",
  today: "danger",
  soon: "warning",
  normal: "brand",
};

// 公開ページの大会の 1 件（設計書 §5.6・§4.2 #1・#6）。トップ・大会一覧で同じ見た目にする
// 一覧の <ul> の中に置く。スマホは 1 列、PC は 2〜3 列（§4.3）
// 選手の情報は出さない（この部品が受け取る PublicTournament にも入っていない）
export function TournamentCard({ slug, tournament, now }: { slug: string; tournament: PublicTournament; now: Date }) {
  return (
    <li>
      <Link href={`/${slug}/tournaments/${tournament.id}`} className="block h-full no-underline">
        <Card interactive className="flex h-full flex-col gap-2">
          <span className="text-lg font-bold break-words">{tournament.name}</span>
          <span className="text-sm text-muted">
            {tournament.eventDate ? `${tournament.eventDate.year}年${formatDateWithWeekday(tournament.eventDate)}開催` : "開催日は未定"}
            {tournament.venue ? `・${tournament.venue}` : ""}
          </span>
          <span className="mt-auto pt-1">
            <Badge tone={TONE[deadlineTone(tournament.entryEndAt, now)]}>{deadlineText(tournament.entryEndAt, now)}</Badge>
          </span>
        </Card>
      </Link>
    </li>
  );
}

// 大会のカードを並べる器。スマホ 1 列 → 768px で 2 列 → 1280px で 3 列
export function TournamentGrid({ children }: { children: React.ReactNode }) {
  return <ul className="bb-stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</ul>;
}
