import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associations, members, memberships, teams, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { findSameNameMembers, suggestMembers } from "@/lib/search/suggest-members";
import { addPlayer, leavePlayer } from "@/lib/teams/roster";
import { registerIndividual } from "@/lib/teams/self";
import { registerTeam } from "@/lib/teams/teams";

// サジェストと「この方ですか？」（設計書 §8.4・§8.3・付録 C・B-08）
// **候補は、ログイン中の人が有効な代表者を務める、有効なチームの現役の選手だけ**
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const YEAR = 2026;

let A = "";
let repId = "";
let otherRepId = "";
let teamXId = "";
let teamYId = "";
let teamZId = "";
const memberIds: Record<string, string> = {};

const player = (name: string, kana: string, birthDate: string, sex: "male" | "female") => ({ name, kana, birthDate, sex });

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `sug-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `sug-other-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [repId, otherRepId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `サジェスト協会 ${random()}`, slug: `sug-${random()}` })
    .returning({ id: associations.id });
  A = association.id;

  const team = (name: string) => ({ name, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false });

  // X = 自分が代表者のチーム、Y = 選手として入っているだけのチーム、Z = 関係ないチーム
  teamXId = (await registerTeam(app, A, repId, team(`さくら ${random()}`))).id;
  teamYId = (await registerTeam(app, A, otherRepId, team(`つばき ${random()}`))).id;
  teamZId = (await registerTeam(app, A, otherRepId, team(`かえで ${random()}`))).id;

  // X の選手（返ってくるべき人たち）
  memberIds.x1 = (await addPlayer(app, as(repId), A, teamXId, player("山田 太郎", "やまだ たろう", "1980-04-01", "male"))).memberId;
  memberIds.x2 = (await addPlayer(app, as(repId), A, teamXId, player("山田 花子", "やまだ はなこ", "1985-06-15", "female"))).memberId;
  memberIds.x3 = (await addPlayer(app, as(repId), A, teamXId, player("鈴木 一郎", "すずき いちろう", "1990-01-20", "male"))).memberId;
  // X から外した人（left_at）。サジェストに出ない
  const left = await addPlayer(app, as(repId), A, teamXId, player("山田 次郎", "やまだ じろう", "1992-02-02", "male"));
  memberIds.xLeft = left.memberId;
  await leavePlayer(app, as(repId), A, teamXId, left.teamMemberId);

  // Y の選手（自分は代表者ではない）と Z の選手。どちらも出ない
  memberIds.y1 = (await addPlayer(app, as(otherRepId), A, teamYId, player("山田 三郎", "やまだ さぶろう", "1975-03-03", "male"))).memberId;
  memberIds.z1 = (await addPlayer(app, as(otherRepId), A, teamZId, player("山田 四郎", "やまだ しろう", "1970-04-04", "male"))).memberId;

  // 個人登録。チーム（kind = individual）なので候補にならない
  await registerIndividual(app, as(otherRepId), A, { name: "山田 五郎", kana: null, birthDate: "1960-05-05", sex: "male" });

  // 協会員（2026 年度）は x1 だけ
  await withTenantOn(owner, A, (tx) =>
    tx.insert(memberships).values({ associationId: A, memberId: memberIds.x1, year: YEAR, status: "approved" }),
  );
}, 60_000);

afterAll(async () => {
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(memberships).where(eq(memberships.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
  });
  await owner.delete(associations).where(eq(associations.id, A));
  await owner.delete(users).where(inArray(users.id, [repId, otherRepId]));
  await closeDb(owner);
  await closeDb(app);
});

const suggest = (userId: string, q: string, over: { membersOnly?: boolean; year?: number } = {}) =>
  suggestMembers(app, A, userId, { q, membersOnly: false, year: YEAR, ...over });

describe("サジェストの候補の範囲（§8.4 v0.9.2）", () => {
  it("代表者を務めるチーム X の現役の選手だけが返る", async () => {
    const rows = await suggest(repId, "やまだ");
    expect(rows.map((r) => r.memberId).sort()).toEqual([memberIds.x1, memberIds.x2].sort());
  });

  it("選手として入っているだけのチーム・関係ないチーム・個人登録の人は返らない", async () => {
    const rows = await suggest(repId, "やまだ");
    const ids = rows.map((r) => r.memberId);
    expect(ids).not.toContain(memberIds.y1);
    expect(ids).not.toContain(memberIds.z1);
    expect(ids).not.toContain(memberIds.xLeft); // 選手一覧から外した人も出ない
  });

  it("代表者を務めるチームがなければ 0 件", async () => {
    const [stranger] = await owner
      .insert(users)
      .values({ email: `sug-none-${random()}@example.com`, emailVerifiedAt: new Date() })
      .returning({ id: users.id });
    try {
      expect(await suggest(stranger.id, "やまだ")).toEqual([]);
    } finally {
      await owner.delete(users).where(eq(users.id, stranger.id));
    }
  });

  it("ほかのチームの代表者には、そのチームの選手だけが返る", async () => {
    const rows = await suggest(otherRepId, "やまだ");
    expect(rows.map((r) => r.memberId).sort()).toEqual([memberIds.y1, memberIds.z1].sort());
  });
});

describe("検索のしかた（§8.4・付録 C）", () => {
  it("正規化後 2 文字未満は返さない（記号だけで空になった場合も）", async () => {
    expect(await suggest(repId, "山")).toEqual([]);
    expect(await suggest(repId, "・")).toEqual([]);
    expect(await suggest(repId, "")).toEqual([]);
  });

  it("漢字の部分一致・ふりがな・空白ゆれのどれでも引ける（normalizeName を通す）", async () => {
    expect((await suggest(repId, "山田")).length).toBe(2);
    expect((await suggest(repId, "はなこ")).map((r) => r.memberId)).toEqual([memberIds.x2]);
    expect((await suggest(repId, "　やまだ　はなこ　")).map((r) => r.memberId)).toEqual([memberIds.x2]);
  });

  it("前方一致が先に並ぶ", async () => {
    const rows = await suggest(repId, "すずき");
    expect(rows.map((r) => r.memberId)).toEqual([memberIds.x3]);
  });

  it("生年月日・性別・チーム名を返す（候補は自分のチームの選手だけなので返してよい・§3.2）", async () => {
    const [row] = (await suggest(repId, "やまだたろう")).filter((r) => r.memberId === memberIds.x1);
    expect(row.birthDate).toBe("1980-04-01");
    expect(row.sex).toBe("male");
    expect(row.teamNames.length).toBe(1);
    expect(row.entryCount).toBe(0);
  });

  it("「協会員だけを表示」でその年度の承認済みだけに絞る", async () => {
    const all = await suggest(repId, "やまだ");
    expect(all.filter((r) => r.isMember).map((r) => r.memberId)).toEqual([memberIds.x1]);
    const only = await suggest(repId, "やまだ", { membersOnly: true });
    expect(only.map((r) => r.memberId)).toEqual([memberIds.x1]);
    // 年度が違えば協会員ではない
    expect(await suggest(repId, "やまだ", { membersOnly: true, year: YEAR - 1 })).toEqual([]);
  });
});

describe("「この方ですか？」の候補（§8.3）", () => {
  const sameName = (userId: string, name: string) => findSameNameMembers(app, A, userId, { name, year: YEAR });

  it("氏名（正規化後）が完全に一致する人だけ。部分一致・ふりがなでは出さない", async () => {
    expect((await sameName(repId, "山田 太郎")).map((r) => r.memberId)).toEqual([memberIds.x1]);
    expect(await sameName(repId, "山田")).toEqual([]);
    expect(await sameName(repId, "やまだたろう")).toEqual([]);
  });

  it("範囲はサジェストと同じ（ほかのチームの同姓同名は出さない）", async () => {
    expect(await sameName(repId, "山田 三郎")).toEqual([]);
    expect(await sameName(repId, "")).toEqual([]);
  });
});
