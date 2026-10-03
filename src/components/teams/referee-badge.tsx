import type { RefereeGrade } from "@/db/schema";
import { REFEREE_GRADE_LABEL } from "@/lib/teams/player-input";

// 審判の資格の印（K-01）。級ごとに色（A=赤・B=黄・C=白）を変えるが、
// 色だけに頼らず必ず「A級（赤）」の文字を入れる（§4.5 原則 2）。色は CSS 変数だけで指定する（§5.17）
const TONE: Record<RefereeGrade, string> = {
  a: "border-referee-a-border bg-referee-a-surface text-referee-a",
  b: "border-referee-b-border bg-referee-b-surface text-referee-b",
  c: "border-referee-c-border bg-referee-c-surface text-referee-c",
};

const MARK: Record<RefereeGrade, string> = {
  a: "bg-referee-a-mark border-referee-a-border",
  b: "bg-referee-b-mark border-referee-b-border",
  c: "bg-referee-c-mark border-referee-c-border",
};

// grade が null なら何も出さない（「なし」はあえて書かない）。審判No は見てよい人にだけ渡す
export function RefereeBadge({ grade, no }: { grade: RefereeGrade | null; no?: string | null }) {
  if (!grade) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm font-semibold ${TONE[grade]}`}>
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full border ${MARK[grade]}`} />
      審判 {REFEREE_GRADE_LABEL[grade]}
      {no ? <span className="font-normal">No.{no}</span> : null}
    </span>
  );
}
