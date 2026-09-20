"use client";

import { useEffect, useState } from "react";
import { normalizeName } from "@/lib/normalize";
import { SUGGEST_MIN_LENGTH } from "@/lib/search/member-search";

// サジェストと「この方ですか？」の呼び出し（設計書 §8.4・§8.3）
// 氏名は URL に載せず、POST の本文で送る（クエリ文字列はリクエストログに残る・§12）
// 正規化後 2 文字以上になってから、200 ms 待って 1 回だけ呼ぶ（§5.5(a)）

const DEBOUNCE_MS = 200;

export type SameNameCandidate = {
  member_id: string;
  name: string;
  kana: string | null;
  birth_date: string;
  sex: "male" | "female";
  team_names: string[];
  is_member: boolean;
};

type Body = { members?: SameNameCandidate[] };

async function post(url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<SameNameCandidate[]> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return [];
    const parsed = (await response.json()) as Body;
    return parsed.members ?? [];
  } catch {
    return []; // 通信できないときは候補を出さない（入力は続けられる）
  }
}

export function useMemberSuggest({
  slug,
  year,
  membersOnly,
  query,
}: {
  slug: string;
  year: number;
  membersOnly: boolean;
  query: string;
}) {
  // 「どの条件で引いた結果か」ごと持つ。条件が変わった瞬間は前の結果を出さない（effect の中で setState しないため）
  const [found, setFound] = useState<{ key: string; rows: SameNameCandidate[] }>({ key: "", rows: [] });
  const enough = normalizeName(query).length >= SUGGEST_MIN_LENGTH;
  const key = `${slug}\u0000${year}\u0000${membersOnly}\u0000${query}`;

  useEffect(() => {
    if (!enough) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const rows = await post(`/api/${slug}/members/suggest`, { q: query, members_only: membersOnly, year }, controller.signal);
      if (!controller.signal.aborted) setFound({ key, rows });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [slug, year, membersOnly, query, enough, key]);

  const findSameName = (name: string) => post(`/api/${slug}/members/same-name`, { name });

  return {
    suggestions: enough && found.key === key ? found.rows : [],
    searching: enough && found.key !== key,
    findSameName,
  };
}
