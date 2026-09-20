import type { Db } from "@/db/client";
import { withTenantOn } from "@/db/tenant";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { TeamError } from "@/lib/teams/errors";
import type { MemberSearch, MemberSuggestion } from "./member-search";
import { postgresMemberSearch } from "./postgres-member-search";

// サジェストと「この方ですか？」の入口（設計書 §8.4・§8.3）
// 認可: ログインしている人（代表者を務めるチームがなければ 0 件になる。403 にはしない）
// レート制限 60 回/分/ユーザー（回数は DB で数える・§9.2）。1 日の上限は設けない（§8.4 v0.9.2）

export const SUGGEST_LIMIT_PER_MINUTE = 60;
const MINUTE_MS = 60 * 1000;

async function limit(db: Db, userId: string): Promise<void> {
  const result = await consumeRateLimit(db, {
    key: `member_suggest:user:${userId}`,
    limit: SUGGEST_LIMIT_PER_MINUTE,
    windowMs: MINUTE_MS,
  });
  if (!result.allowed) {
    throw new TeamError(429, "検索が続いています。少し待ってからお試しください", { retryAt: result.retryAt.toISOString() });
  }
}

export async function suggestMembers(
  db: Db,
  associationId: string,
  userId: string,
  input: { q: string; membersOnly: boolean; year: number },
  search: MemberSearch = postgresMemberSearch,
): Promise<MemberSuggestion[]> {
  await limit(db, userId);
  return withTenantOn(db, associationId, (tx) => search.suggest(tx, associationId, userId, input), { userId });
}

export async function findSameNameMembers(
  db: Db,
  associationId: string,
  userId: string,
  input: { name: string; year: number },
  search: MemberSearch = postgresMemberSearch,
): Promise<MemberSuggestion[]> {
  await limit(db, userId);
  return withTenantOn(db, associationId, (tx) => search.sameName(tx, associationId, userId, input), { userId });
}
