// 物理削除の理由（設計書 §5.16）。人物を消すときの申込の記録の扱いが変わるので、画面で選んでもらう
// 画面（クライアント）からも読むので、サーバー専用の import を置かない

export const PURGE_REASON_KEYS = ["retention", "request", "mistake", "other"] as const;
export type PurgeReasonKind = (typeof PURGE_REASON_KEYS)[number];

export const PURGE_REASON_LABEL: Record<PurgeReasonKind, string> = {
  retention: "保存期間の満了（最終参加から 5 年）",
  request: "本人からの依頼",
  mistake: "誤登録",
  other: "その他",
};

export function isPurgeReasonKind(value: unknown): value is PurgeReasonKind {
  return typeof value === "string" && (PURGE_REASON_KEYS as readonly string[]).includes(value);
}

// 申込の記録に残す「消した人」の書き方（§5.16）
export const DELETED_NAME = "（削除済み）";
