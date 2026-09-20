import type { MemberSex } from "@/db/schema";
import type { Tx } from "@/db/tenant";

// 申込の選手枠で使う人物の検索（設計書 §8.4・§8.3）。実装はこのインターフェース越しに呼ぶ（将来 ES へ差し替え可能）
//
// **候補の範囲は、ログイン中の人が有効な代表者を務める、有効なチームの現役の選手だけ**（§8.4 v0.9.2）。
// 協会内のほかの人は返さない。代表者を務めるチームがなければ 0 件。
// 生年月日を返してよいのは、候補がすべて代表者自身のチームの選手だから（§3.2）

export const SUGGEST_MIN_LENGTH = 2; // 正規化後の文字数。これ未満なら候補を返さない（§8.4・§5.5(a)）
export const SUGGEST_LIMIT = 10;
export const SAME_NAME_LIMIT = 3; // 「この方ですか？」のカードは最大 3 件（§8.3）

export type MemberSuggestion = {
  memberId: string;
  name: string;
  kana: string | null;
  birthDate: string; // YYYY-MM-DD（§7.0）
  sex: MemberSex;
  teamNames: string[]; // その人が載っている、代表者を務めるチームの名前
  isMember: boolean; // その年度の協会員か
  entryCount: number;
  lastEntryAt: Date | null;
};

export type SuggestQuery = {
  q: string; // 正規化前の入力。実装が normalizeName を通す
  membersOnly: boolean; // 「協会員だけを表示」
  year: number; // 大会の開催日の年度
};

export type SameNameQuery = {
  name: string; // 正規化前の氏名
  year: number; // is_member を出すための年度
};

export interface MemberSearch {
  // 部分一致・ふりがな・類似度（§8.4・付録 C）。上限 10 件
  suggest(tx: Tx, associationId: string, userId: string, query: SuggestQuery): Promise<MemberSuggestion[]>;
  // 正規化後の氏名が**完全に一致**する人だけ（部分一致・ふりがな・異体字では出さない・§8.3）。上限 3 件
  sameName(tx: Tx, associationId: string, userId: string, query: SameNameQuery): Promise<MemberSuggestion[]>;
}
