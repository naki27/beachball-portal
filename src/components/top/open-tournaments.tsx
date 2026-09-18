// 受付中の大会（設計書 §5.17 の既定の並びの 1 つ目）。大会の一覧は B-06 で入れる。今は大会の表がないので常に空
export function OpenTournaments() {
  return (
    <section aria-labelledby="open-tournaments" className="flex flex-col gap-3">
      <h2 id="open-tournaments" className="text-lg font-bold">
        受付中の大会
      </h2>
      <p className="leading-relaxed text-muted">いま申し込みを受け付けている大会はありません。</p>
    </section>
  );
}
