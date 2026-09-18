import type { Db } from "@/db/client";
import type { MemberSex } from "@/db/schema";
import { type Tx, withTenantOn } from "@/db/tenant";
import { ageAt } from "@/lib/age";
import type { Principal } from "@/lib/authz";
import { parsePlainDate, todayInTokyo } from "@/lib/date";
import { resolveMember } from "@/lib/matching";
import { findMember, findMemberByUserId, setMemberUser } from "@/lib/repo/members";
import { addTeamMember, findActiveTeamMember } from "@/lib/repo/team-members";
import { addTeamAdmin, createTeam, findIndividualTeamOf, type Team } from "@/lib/repo/teams";
import { authorizeTeam } from "./access";
import { TeamError } from "./errors";
import { parsePlayerInput, type PlayerInput } from "./player-input";

// 本人の登録（設計書 §5.11「個人登録」「自分を選手として登録する」・§5.15「注意点」）
// どちらも「本人のアカウントに人物を紐づける」操作。承諾は要らない（本人の操作だから）
// 協会内で 1 アカウント = 1 人物なので、すでに紐づいた人物があればそれを使い、入力は省く

export type MyPerson = { memberId: string; name: string; kana: string | null; birthDate: string; age: number; sex: MemberSex };

function personOf(row: { id: string; name: string; kana: string | null; birthDate: string; sex: MemberSex }, now: Date): MyPerson {
  const birth = parsePlainDate(row.birthDate);
  return { memberId: row.id, name: row.name, kana: row.kana, birthDate: row.birthDate, age: birth ? ageAt(birth, todayInTokyo(now)) : 0, sex: row.sex };
}

// ログイン中の人に紐づいた人物（本人の情報なので生年月日を含めてよい・§3.2）。なければ null
export async function getMyPerson(db: Db, principal: Principal & { userId: string }, associationId: string, now = new Date()): Promise<MyPerson | null> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const row = await findMemberByUserId(tx, associationId, principal.userId);
      return row ? personOf(row, now) : null;
    },
    { userId: principal.userId },
  );
}

// 本人の人物を決めて、自分のアカウントに紐づける。すでに紐づいた人物があればそれ（raw は見ない）
// なければ入力を名寄せ（§8.3）し、結びついた人物が別のアカウントに紐づいていれば新しい人物を作って要確認にする（§5.15: 1 人物 = 1 アカウント）
async function resolveSelf(tx: Tx, associationId: string, userId: string, raw: Record<string, unknown>, now: Date): Promise<{ memberId: string; name: string }> {
  const linked = await findMemberByUserId(tx, associationId, userId);
  if (linked) return { memberId: linked.id, name: linked.name };

  const parsed = parsePlayerInput(raw, todayInTokyo(now));
  if (!parsed.ok) throw new TeamError(400, parsed.message, { field: parsed.field });
  const person: PlayerInput = parsed.value;
  let resolved = await resolveMember(tx, associationId, person);
  if (!resolved.created) {
    const matched = await findMember(tx, associationId, resolved.memberId);
    if (matched?.userId && matched.userId !== userId) {
      // 同じ氏名・生年月日・性別の人物がほかの人のアカウントに紐づいている。自動では結びつけず、人が確かめる
      resolved = await resolveMember(tx, associationId, person, { kind: "declined" });
    }
  }
  await setMemberUser(tx, associationId, resolved.memberId, userId);
  return { memberId: resolved.memberId, name: person.name };
}

export type IndividualRegistration = { team: Team; memberId: string };

// 個人で登録（§5.11「個人登録」）。内部は kind = individual のチーム（選手一覧は本人だけ・常に協会員の登録をする・1 協会 1 つ）
export async function registerIndividual(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  raw: Record<string, unknown>,
  now = new Date(),
): Promise<IndividualRegistration> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const existing = await findIndividualTeamOf(tx, associationId, principal.userId);
      if (existing) throw new TeamError(409, "個人の登録はすでにあります", { teamId: existing.id });
      const self = await resolveSelf(tx, associationId, principal.userId, raw, now);
      const team = await createTeam(tx, associationId, {
        name: self.name,
        kind: "individual",
        membershipRenewalTarget: true,
        createdBy: principal.userId,
      });
      await addTeamAdmin(tx, associationId, team.id, principal.userId, null);
      await addTeamMember(tx, associationId, team.id, self.memberId);
      return { team, memberId: self.memberId };
    },
    { userId: principal.userId },
  );
}

// 「自分を選手として登録する」（§5.11「名簿の管理」）。代表者が自分の人物を自分のチームの選手一覧に加え、招待を挟まずに紐づける
export async function registerSelfAsPlayer(
  db: Db,
  principal: Principal & { userId: string },
  associationId: string,
  teamId: string,
  raw: Record<string, unknown>,
  now = new Date(),
): Promise<{ teamMemberId: string; memberId: string }> {
  return withTenantOn(
    db,
    associationId,
    async (tx) => {
      const { team } = await authorizeTeam(tx, principal, associationId, teamId, "manageRoster");
      if (team.kind === "individual") throw new TeamError(409, "個人の登録には、ほかの人を加えられません");
      const self = await resolveSelf(tx, associationId, principal.userId, raw, now);
      if (await findActiveTeamMember(tx, associationId, teamId, self.memberId)) {
        throw new TeamError(409, "あなたはすでに選手一覧にいます");
      }
      const row = await addTeamMember(tx, associationId, teamId, self.memberId);
      return { teamMemberId: row.id, memberId: self.memberId };
    },
    { userId: principal.userId },
  );
}
