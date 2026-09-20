import { sql } from "drizzle-orm";
import type { MemberSex } from "@/db/schema";
import type { Tx } from "@/db/tenant";
import { normalizeName } from "@/lib/normalize";
import {
  type MemberSearch,
  type MemberSuggestion,
  SAME_NAME_LIMIT,
  type SameNameQuery,
  SUGGEST_LIMIT,
  SUGGEST_MIN_LENGTH,
  type SuggestQuery,
} from "./member-search";

// サジェストの SQL（設計書 付録 C・§8.4）。SQL の直書きが許されているのはこことマイグレーションだけ（CLAUDE.md）
// 協会は SQL の中でも必ず絞る（RLS と二重）。範囲を代表者を務めるチームに絞るのは team_admins の join

const SIMILARITY_THRESHOLD = "0.3"; // 既定値に頼らず、同じトランザクションで明示する（% 演算子で GIN を使うため）

type SuggestionRow = {
  member_id: string;
  name: string;
  kana: string | null;
  birth_date: string;
  sex: MemberSex;
  team_names: string[];
  is_member: boolean;
  entry_count: number;
  last_entry_at: Date | null;
};

function toSuggestion(row: SuggestionRow): MemberSuggestion {
  return {
    memberId: row.member_id,
    name: row.name,
    kana: row.kana,
    birthDate: row.birth_date,
    sex: row.sex,
    teamNames: row.team_names ?? [],
    isMember: row.is_member,
    entryCount: Number(row.entry_count ?? 0),
    lastEntryAt: row.last_entry_at,
  };
}

export const postgresMemberSearch: MemberSearch = {
  async suggest(tx: Tx, associationId: string, userId: string, query: SuggestQuery): Promise<MemberSuggestion[]> {
    // 正規化は保存時と同じ関数を使う（§8.4）。正規化後 2 文字未満は候補を返さない（記号だけで空になった場合も）
    const nq = normalizeName(query.q);
    if (nq.length < SUGGEST_MIN_LENGTH) return [];

    await tx.execute(sql`select set_config('pg_trgm.similarity_threshold', ${SIMILARITY_THRESHOLD}, true)`);

    const result = await tx.execute<SuggestionRow>(sql`
      select s.member_id, s.name, s.kana,
             to_char(s.birth_date, 'YYYY-MM-DD') as birth_date, s.sex,
             array_agg(distinct s.team_name order by s.team_name) as team_names,
             bool_or(coalesce(s.name_normalized like ${nq} || '%' or s.kana_normalized like ${nq} || '%', false)) as is_prefix,
             max(greatest(similarity(s.name_normalized, ${nq}),
                          coalesce(similarity(s.kana_normalized, ${nq}), 0))) as sim,
             exists (select 1 from memberships ms
                      where ms.association_id = ${associationId} and ms.member_id = s.member_id
                        and ms.year = ${query.year} and ms.status = 'approved' and ms.deleted_at is null) as is_member,
             max(s.entry_count) as entry_count, max(s.last_entry_at) as last_entry_at
      from player_suggestions s
      join team_admins ta on ta.team_id = s.team_id
                        and ta.user_id = ${userId} and ta.revoked_at is null
      where s.association_id = ${associationId}
        and (s.name_normalized like '%' || ${nq} || '%'
         or s.kana_normalized like '%' || ${nq} || '%'
         or (length(${nq}) >= 3 and (s.name_normalized % ${nq} or s.kana_normalized % ${nq})))
      group by s.member_id, s.name, s.kana, s.birth_date, s.sex
      having not ${query.membersOnly}::boolean
          or exists (select 1 from memberships ms
                      where ms.association_id = ${associationId} and ms.member_id = s.member_id
                        and ms.year = ${query.year} and ms.status = 'approved' and ms.deleted_at is null)
      order by is_prefix desc, sim desc, entry_count desc, last_entry_at desc nulls last
      limit ${SUGGEST_LIMIT}
    `);
    return result.rows.map(toSuggestion);
  },

  // 「この方ですか？」の候補（§8.3）。氏名（正規化後）が完全に一致する人だけ。範囲はサジェストと同じ
  async sameName(tx: Tx, associationId: string, userId: string, query: SameNameQuery): Promise<MemberSuggestion[]> {
    const nq = normalizeName(query.name);
    if (nq.length === 0) return [];

    const result = await tx.execute<SuggestionRow>(sql`
      select s.member_id, s.name, s.kana,
             to_char(s.birth_date, 'YYYY-MM-DD') as birth_date, s.sex,
             array_agg(distinct s.team_name order by s.team_name) as team_names,
             exists (select 1 from memberships ms
                      where ms.association_id = ${associationId} and ms.member_id = s.member_id
                        and ms.year = ${query.year} and ms.status = 'approved' and ms.deleted_at is null) as is_member,
             max(s.entry_count) as entry_count, max(s.last_entry_at) as last_entry_at
      from player_suggestions s
      join team_admins ta on ta.team_id = s.team_id
                        and ta.user_id = ${userId} and ta.revoked_at is null
      where s.association_id = ${associationId}
        and s.name_normalized = ${nq}
      group by s.member_id, s.name, s.kana, s.birth_date, s.sex
      order by entry_count desc, last_entry_at desc nulls last
      limit ${SAME_NAME_LIMIT}
    `);
    return result.rows.map(toSuggestion);
  },
};
