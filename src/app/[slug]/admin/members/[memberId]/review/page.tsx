import type { Metadata } from "next";
import Link from "next/link";
import { PageMain } from "@/components/ui/layout";
import { getDb } from "@/db/client";
import { getMergeView, type MergeView } from "@/lib/admin/merge-members";
import { getPrincipal } from "@/lib/auth/principal";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";
import { SEX_LABEL } from "@/lib/teams/player-input";
import { MergeControls } from "./merge-controls";

type Props = { params: Promise<{ slug: string; memberId: string }> };

export const metadata: Metadata = { title: "登録の確認" };

// 要確認の解消と、2 つの人物をまとめる最小の画面（設計書 §5.8・P0）。テナント管理者だけ
// 同じ氏名（正規化後）の人物と、ふりがなと生年月日が同じ人物を横に並べて出す
export default async function MemberReviewPage({ params }: Props) {
  const { slug, memberId } = await params;
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();

  let view: MergeView;
  try {
    view = await getMergeView(getDb(), { ...principal, userId: principal.userId }, association.id, memberId);
  } catch (error) {
    pageErrorFrom(error);
  }

  const { member } = view;
  return (
    <PageMain width="wide">
      <p>
        <Link href={`/${association.slug}/admin/members/${member.id}`} className="underline underline-offset-2">
          ← {member.name}
        </Link>
      </p>
      <h1 className="text-2xl font-bold break-words">{member.name}の登録を確かめる</h1>
      <p className="leading-relaxed">
        同じ人が二重に登録されていないかを確かめます。並んでいる登録が別の人であれば「別の人です」、同じ人であれば「まとめる」を選んでください。
      </p>

      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">この登録と、似ている登録の比較</caption>
        <thead>
          <tr>
            <th scope="col" className="w-28 border border-border px-2 py-1 text-left">
              項目
            </th>
            <th scope="col" className="border border-border px-2 py-1 text-left break-words">
              この登録
            </th>
            {view.candidates.map((candidate) => (
              <th key={candidate.id} scope="col" className="border border-border px-2 py-1 text-left break-words">
                似ている登録
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["氏名", (p: MergeView["member"]) => p.name],
              ["ふりがな", (p: MergeView["member"]) => p.kana ?? "—"],
              ["生年月日", (p: MergeView["member"]) => `${p.birthDate}（${p.age}歳）`],
              ["性別", (p: MergeView["member"]) => SEX_LABEL[p.sex]],
              ["チーム", (p: MergeView["member"]) => (p.teamNames.length > 0 ? p.teamNames.join("・") : "—")],
              ["申し込み", (p: MergeView["member"]) => `${p.entryCount} 回`],
              ["ログイン", (p: MergeView["member"]) => (p.linkedEmail ? "できます" : "紐づけなし")],
            ] as const
          ).map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="border border-border px-2 py-1 text-left font-semibold">
                {label}
              </th>
              <td className="border border-border px-2 py-1 break-words">{value(member)}</td>
              {view.candidates.map((candidate) => (
                <td key={candidate.id} className="border border-border px-2 py-1 break-words">
                  {value(candidate)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <MergeControls slug={association.slug} member={member} candidates={view.candidates} />
    </PageMain>
  );
}
