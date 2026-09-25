import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/components/memberships/approval-panel";
import { getDb } from "@/db/client";
import { getMembershipYearForAdmin } from "@/lib/admin/membership-approval";
import { getPrincipal } from "@/lib/auth/principal";
import { formatDateTimeTokyo, formatDateWithWeekday, todayInTokyo } from "@/lib/date";
import { fiscalYearLabel } from "@/lib/memberships/period-input";
import { denyPage } from "@/lib/page/forbidden";
import { requireAssociation } from "@/lib/page/require-association";
import { pageErrorFrom } from "@/lib/page/team-errors";

type Props = { params: Promise<{ slug: string; year: string }> };

export const metadata: Metadata = { title: "申告の状況" };

const STATE_LABEL = { before: "受付前", open: "受付中", closed: "締切後" } as const;

// 年度ごとの申告の状況（設計書 §5.12・§4.2 #17）。テナント管理者だけ
// 未申告（対象チームだけ）・申告済みの内訳と一括承認・追加の申告の承認。代理の申告・修正は各チームの申告の画面で
export default async function MembershipYearPage({ params }: Props) {
  const { slug, year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const association = await requireAssociation(slug);
  const principal = await getPrincipal();
  if (!principal.userId) denyPage();
  const now = new Date();
  const view = await getMembershipYearForAdmin(getDb(), { ...principal, userId: principal.userId }, association.id, Number(year), now).catch(pageErrorFrom);
  const label = fiscalYearLabel(view.period.year);
  const teamHref = (id: string) => `/${association.slug}/teams/${id}/membership`;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <p>
        <Link href={`/${association.slug}/admin/memberships`} className="underline underline-offset-2">
          ← 会員の管理
        </Link>
      </p>
      <h1 className="text-2xl font-bold">{label}の申告の状況</h1>
      <p className="text-sm text-muted">
        受付期間: {formatDateWithWeekday(todayInTokyo(view.period.opensAt))} 〜 {formatDateWithWeekday(todayInTokyo(view.period.closesAt))}（
        {STATE_LABEL[view.state]}）・承認: {view.period.autoApprove ? "省く" : "運営が承認する"}
      </p>

      <section aria-labelledby="undeclared" className="flex flex-col gap-3">
        <h2 id="undeclared" className="text-lg font-bold">
          未申告のチーム（{view.undeclared.length}）
        </h2>
        <p className="text-sm text-muted">「協会員の登録をするチーム」と個人登録のうち、{label}の申告をまだ送っていないもの。</p>
        {view.undeclared.length === 0 ? (
          <p className="text-sm text-muted">未申告のチームはありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.undeclared.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-4 py-3">
                <span className="font-semibold break-words">
                  {t.name}
                  {t.kind === "individual" ? <span className="ml-2 text-sm text-muted">個人の登録</span> : null}
                </span>
                <Link href={teamHref(t.id)} className="text-sm font-semibold underline underline-offset-2">
                  代理で申告する
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="declared" className="flex flex-col gap-3">
        <h2 id="declared" className="text-lg font-bold">
          申告済みのチーム（{view.declared.length}）
        </h2>
        {view.declared.length === 0 ? (
          <p className="text-sm text-muted">まだ申告はありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.declared.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold break-words">{t.name}</span>
                  <Link href={teamHref(t.id)} className="text-sm font-semibold underline underline-offset-2">
                    代理で直す
                  </Link>
                </div>
                <p className="text-sm text-muted">
                  運営の確認待ち {t.summary.applied} 人・協会員 {t.summary.approved} 人・更新しない {t.summary.declined} 人
                  {t.summary.additionalApplied > 0 ? `・追加の申告 ${t.summary.additionalApplied} 人` : ""}
                </p>
                {t.declaration ? <p className="text-sm text-muted">最終更新: {formatDateTimeTokyo(t.declaration.updatedAt)}</p> : null}
              </li>
            ))}
          </ul>
        )}
        <ApprovalPanel
          slug={association.slug}
          year={view.period.year}
          scope="renewal"
          count={view.pendingRenewals}
          label={`運営の確認待ちの ${view.pendingRenewals} 人をまとめて承認する`}
        />
      </section>

      <section aria-labelledby="additional" className="flex flex-col gap-3">
        <h2 id="additional" className="text-lg font-bold">
          追加の申告（{view.additional.reduce((n, a) => n + a.rows.length, 0)} 人）
        </h2>
        <p className="text-sm text-muted">年度の途中に入った人の申告。承認を省く年度でも、ここで承認します。</p>
        {view.additional.length === 0 ? (
          <p className="text-sm text-muted">承認待ちの追加の申告はありません。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {view.additional.map((a) => (
              <li key={a.team.id} className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
                <p className="font-semibold break-words">{a.team.name}</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {a.rows.map((r) => (
                    <li key={r.id}>
                      {r.name}
                      {r.appliedAt ? <span className="text-muted">（{formatDateTimeTokyo(r.appliedAt)}）</span> : null}
                    </li>
                  ))}
                </ul>
                <ApprovalPanel slug={association.slug} year={view.period.year} scope="additional" teamIds={[a.team.id]} count={a.rows.length} label={`${a.rows.length} 人を承認する`} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
