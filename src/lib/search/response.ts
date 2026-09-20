import type { MemberSuggestion } from "@/lib/search/member-search";

// 応答の形（設計書 §8.4）。生年月日を返してよいのは、候補がすべて代表者自身のチームの選手だから（§3.2）
export type MemberSuggestionResponse = {
  member_id: string;
  name: string;
  kana: string | null;
  birth_date: string;
  sex: string;
  team_names: string[];
  is_member: boolean;
  entry_count: number;
  last_entry_at: string | null;
};

export function toSuggestionResponse(row: MemberSuggestion): MemberSuggestionResponse {
  return {
    member_id: row.memberId,
    name: row.name,
    kana: row.kana,
    birth_date: row.birthDate,
    sex: row.sex,
    team_names: row.teamNames,
    is_member: row.isMember,
    entry_count: row.entryCount,
    last_entry_at: row.lastEntryAt?.toISOString() ?? null,
  };
}
