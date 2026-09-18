import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { members, teamAdmins, teamMembers, teams, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { normalizeName } from "@/lib/normalize";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer, getRoster } from "@/lib/teams/roster";
import { getMyPerson, registerIndividual, registerSelfAsPlayer } from "@/lib/teams/self";
import { registerTeam } from "@/lib/teams/teams";

// 個人登録と「自分を選手として登録する」（設計書 §5.11・§5.15「注意点」）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const random = () => Math.random().toString(36).slice(2, 8);
const S = SAWARA_ASSOCIATION_ID;
const tag = `個人${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const ids = { a: "", b: "", c: "" };

const person = (name: string, extra: Record<string, unknown> = {}) => ({
  name: `${tag} ${name}`,
  kana: "",
  birthDate: "1988-08-08",
  sex: "female",
  ...extra,
});

async function statusOf(run: () => Promise<unknown>): Promise<number | "ok"> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

beforeAll(async () => {
  for (const key of Object.keys(ids) as (keyof typeof ids)[]) {
    const [u] = await owner.insert(users).values({ email: `individual-${key}-${random()}@example.com` }).returning({ id: users.id });
    ids[key] = u.id;
  }
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(teams).where(inArray(teams.createdBy, Object.values(ids)));
    await tx.delete(members).where(and(eq(members.associationId, S), like(members.nameNormalized, `${normalizeName(tag)}%`)));
  });
  await owner.delete(users).where(inArray(users.id, Object.values(ids)));
  await closeDb(owner);
  await closeDb(app);
});

describe("個人で登録", () => {
  it("本人の情報だけで登録でき、kind = individual・名前は本人の氏名・常に協会員の登録をする・代表者と選手一覧は本人", async () => {
    const { team, memberId } = await registerIndividual(app, as(ids.a), S, person("花子", { kana: "はなこ" }));
    expect(team).toMatchObject({ kind: "individual", name: `${tag} 花子`, membershipRenewalTarget: true, createdBy: ids.a });
    const [admin] = await withTenantOn(owner, S, (tx) => tx.select().from(teamAdmins).where(eq(teamAdmins.teamId, team.id)));
    expect(admin).toMatchObject({ userId: ids.a, grantedBy: null });
    const rows = await withTenantOn(owner, S, (tx) => tx.select().from(teamMembers).where(eq(teamMembers.teamId, team.id)));
    expect(rows.map((r) => r.memberId)).toEqual([memberId]);
    // 本人のアカウントに紐づく
    const [m] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, memberId)));
    expect(m.userId).toBe(ids.a);
    expect(await getMyPerson(app, as(ids.a), S)).toMatchObject({ memberId, name: `${tag} 花子`, kana: "はなこ", birthDate: "1988-08-08", sex: "female" });
  });

  it("1 協会で個人登録は 1 つまで（409）", async () => {
    expect(await statusOf(() => registerIndividual(app, as(ids.a), S, person("花子")))).toBe(409);
  });

  it("個人の登録にはほかの人を加えられない（409）", async () => {
    const mine = (await getRoster(app, as(ids.a), S, (await teamOf(ids.a)).id)).team.id;
    expect(await statusOf(() => addPlayer(app, as(ids.a), S, mine, person("太郎", { sex: "male" })))).toBe(409);
  });

  it("入力の誤りは 400", async () => {
    expect(await statusOf(() => registerIndividual(app, as(ids.b), S, { name: "" }))).toBe(400);
  });
});

async function teamOf(userId: string) {
  const [team] = await withTenantOn(owner, S, (tx) =>
    tx.select().from(teams).where(and(eq(teams.createdBy, userId), eq(teams.kind, "individual"))),
  );
  return team;
}

describe("自分を選手として登録する（協会内で 1 アカウント = 1 人物）", () => {
  it("すでに紐づいた人物があれば入力を見ずにそれを使う。同じチームに 2 回は 409", async () => {
    const base = { kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false };
    const team = await registerTeam(app, S, ids.a, { ...base, name: `${tag} A のチーム` });
    // 別の氏名を送っても、紐づいた人物（花子）が使われる
    const result = await registerSelfAsPlayer(app, as(ids.a), S, team.id, person("別の名前"));
    expect(result.memberId).toBe((await getMyPerson(app, as(ids.a), S))!.memberId);
    const roster = await getRoster(app, as(ids.a), S, team.id);
    expect(roster.items).toHaveLength(1);
    expect(roster.items[0]).toMatchObject({ isSelf: true, name: `${tag} 花子` });
    expect(await statusOf(() => registerSelfAsPlayer(app, as(ids.a), S, team.id, person("花子")))).toBe(409);
  });

  it("紐づいた人物がなければ入力から作って紐づける。そのあとの個人登録は同じ人物を使う", async () => {
    const base = { kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false };
    const team = await registerTeam(app, S, ids.b, { ...base, name: `${tag} B のチーム` });
    const added = await registerSelfAsPlayer(app, as(ids.b), S, team.id, person("次郎", { sex: "male" }));
    const [m] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, added.memberId)));
    expect(m.userId).toBe(ids.b);
    const individual = await registerIndividual(app, as(ids.b), S, { name: "無視される" });
    expect(individual.memberId).toBe(added.memberId);
    expect(individual.team.name).toBe(`${tag} 次郎`);
  });

  it("同じ氏名・生年月日・性別の人物がほかの人のアカウントに紐づいていれば、結びつけずに新しい人物（要確認）を作る", async () => {
    // c が「花子」（a の人物と同じ氏名・生年月日・性別）として個人登録する
    const { memberId } = await registerIndividual(app, as(ids.c), S, person("花子"));
    const aMember = (await getMyPerson(app, as(ids.a), S))!.memberId;
    expect(memberId).not.toBe(aMember);
    const [m] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, memberId)));
    expect(m).toMatchObject({ userId: ids.c, status: "needs_review" });
    const [a] = await withTenantOn(owner, S, (tx) => tx.select().from(members).where(eq(members.id, aMember)));
    expect(a.userId).toBe(ids.a);
  });

  it("代表者でない人は 403", async () => {
    const team = await teamOf(ids.a);
    expect(await statusOf(() => registerSelfAsPlayer(app, as(ids.b), S, team.id, person("次郎")))).toBe(403);
  });
});
