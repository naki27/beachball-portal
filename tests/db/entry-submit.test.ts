import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, categoryPresets, entries, mailLogs, members, teams, tournaments, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin, editCategory } from "@/lib/admin/categories";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { getEntryDetail } from "@/lib/entries/entry-detail";
import { composeMail } from "@/lib/mail/templates";
import { submitEntry } from "@/lib/entries/submit-entry";
import type { PlayerSlot } from "@/lib/entries/player-slots";
import { countOpenEntries, listEntryPlayers } from "@/lib/repo/entries";
import { TeamError } from "@/lib/teams/errors";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 申込の送信（設計書 §5.5(c)・§5.4「申込上限」・B-10）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
// 同時申込（定員・二重送信）を本当に並行にするための 2 本目の接続。1 本のプールでは順番に流れてしまう
const app2 = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `送信${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
const NOW = new Date("2026-09-20T03:00:00Z");

let A = "";
let adminId = "";
let repId = "";
let rep2Id = "";
let teamId = "";
let team2Id = "";
let openId = "";
const presetIds: Record<string, string> = {};
const categoryIds: Record<string, string> = {};
const roster: { memberId: string; name: string; kana: string; birthDate: string; sex: "male" | "female" }[] = [];

const tournamentInput = (over: Record<string, unknown> = {}) => ({
  name: `${tag} 大会 ${random()}`,
  eventDate: "2026-11-23",
  ageReferenceDate: "2026-11-23",
  venue: "早良体育館",
  description: "",
  entryStartDate: "2026-09-01",
  entryEndDate: "2026-09-30",
  teamSizeMin: "4",
  teamSizeMax: "7",
  maxEntries: "",
  status: "open",
  ...over,
});

const pickSlot = (index: number): PlayerSlot => {
  const p = roster[index];
  return { kind: "pick", memberId: p.memberId, name: p.name, kana: p.kana, birthDate: p.birthDate, sex: p.sex };
};

const manualSlot = (over: Partial<PlayerSlot> = {}): PlayerSlot => ({
  kind: "manual",
  memberId: null,
  name: `${tag} 手入力`,
  kana: "ていりょく",
  birthDate: "1979-03-03",
  sex: "male",
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  teamId,
  newTeamName: "",
  teamName: `${tag} さくら`,
  categoryId: categoryIds.m_free,
  slots: [pickSlot(0), pickSlot(1), pickSlot(2), pickSlot(3)],
  note: "",
  token: crypto.randomUUID(),
  ...over,
});

async function statusOf(run: () => Promise<unknown>): Promise<"ok" | number> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

async function categoriesOf(tournamentId: string): Promise<Record<string, string>> {
  const view = await getCategoriesForAdmin(app, as(adminId), A, tournamentId);
  return Object.fromEntries(view.categories.map((c) => [c.code, c.id]));
}

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `sub-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `sub-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `sub-rep2-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId, rep2Id] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `sub-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  await withTenantOn(owner, A, async (tx) => {
    const rows = await tx
      .insert(categoryPresets)
      .values([
        { associationId: A, code: "m_free", labelDefault: "男子フリーの部", gender: "male", ruleType: "free", sortOrder: 10 },
        { associationId: A, code: "m_60", labelDefault: "男子60歳以上の部", gender: "male", ruleType: "min_age", ruleValue: 60, sortOrder: 20 },
        { associationId: A, code: "x_160", labelDefault: "混合160の部", gender: "mixed", ruleType: "total_age", ruleValue: 160, sortOrder: 30 },
      ])
      .returning({ id: categoryPresets.id, code: categoryPresets.code });
    for (const row of rows) presetIds[row.code] = row.id;
  });

  const team = (name: string) => ({ name, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false });
  teamId = (await registerTeam(app, A, repId, team(`${tag} さくら`))).id;
  team2Id = (await registerTeam(app, A, rep2Id, team(`${tag} つばき`))).id;

  for (const p of [
    { name: `${tag} アキラ`, kana: "あきら", birthDate: "1975-04-01", sex: "male" as const },
    { name: `${tag} イサム`, kana: "いさむ", birthDate: "1978-05-02", sex: "male" as const },
    { name: `${tag} ウシオ`, kana: "うしお", birthDate: "1980-06-03", sex: "male" as const },
    { name: `${tag} エイジ`, kana: "えいじ", birthDate: "1982-07-04", sex: "male" as const },
    { name: `${tag} オサム`, kana: "おさむ", birthDate: "1984-08-05", sex: "male" as const },
    { name: `${tag} カヨコ`, kana: "かよこ", birthDate: "1962-09-06", sex: "female" as const },
    { name: `${tag} キヌヨ`, kana: "きぬよ", birthDate: "1964-10-07", sex: "female" as const },
  ]) {
    const { memberId } = await addPlayer(app, as(repId), A, teamId, p);
    roster.push({ memberId, ...p });
  }

  openId = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 受付中` }))).id;
  await addCategoriesFromPresets(app, as(adminId), A, openId, { presetIds: [presetIds.m_free, presetIds.m_60, presetIds.x_160] });
  Object.assign(categoryIds, await categoriesOf(openId));
}, 60_000);

afterAll(async () => {
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, A));
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(associations).where(eq(associations.id, A));
  await owner.delete(users).where(inArray(users.id, [adminId, repId, rep2Id]));
  await closeDb(owner);
  await closeDb(app);
  await closeDb(app2);
});

describe("申込の保存（§5.5(c)）", () => {
  it("entries と entry_players が保存され、年齢は基準日で確定する", async () => {
    const result = await submitEntry(app, as(repId), A, openId, body(), NOW);
    expect(result.alreadySubmitted).toBe(false);

    const players = await withTenantOn(app, A, (tx) => listEntryPlayers(tx, A, result.entryId));
    expect(players.map((p) => p.position)).toEqual([1, 2, 3, 4]);
    // 1975-04-01 生まれ・基準日 2026-11-23 → 51 歳
    expect(players[0].ageAtEvent).toBe(51);
    expect(players.every((p) => p.memberId !== null)).toBe(true);
  });

  it("申込完了メールを、そのチームの有効な代表者全員に積む（§5.7・§11）", async () => {
    const result = await submitEntry(app, as(repId), A, openId, body(), NOW);
    const queued = await owner.select().from(mailLogs).where(eq(mailLogs.entryId, result.entryId));
    expect(queued).toHaveLength(1);
    expect(queued[0].mailType).toBe("entry_completed");
    expect(queued[0].status).toBe("queued");
    // 本文は積まない（params は ID だけ・付録 A）
    expect(JSON.stringify(queued[0].params)).not.toContain(tag);
  });

  it("手入力の選手は名寄せして、申し込むチームの選手一覧に自動で加える（§5.5(c) 3・4）", async () => {
    const result = await submitEntry(
      app,
      as(repId),
      A,
      openId,
      body({ slots: [pickSlot(0), pickSlot(1), pickSlot(2), manualSlot()] }),
      NOW,
    );
    const players = await withTenantOn(app, A, (tx) => listEntryPlayers(tx, A, result.entryId));
    const added = players[3];
    expect(added.memberId).not.toBeNull();
    // 選手一覧に入っている
    const { findActiveTeamMember } = await import("@/lib/repo/team-members");
    const onRoster = await withTenantOn(app, A, (tx) => findActiveTeamMember(tx, A, teamId, added.memberId as string));
    expect(onRoster).not.toBeNull();
  });

  it("members.entry_count と last_entry_at が増える（§5.5(c) 6）", async () => {
    const before = await withTenantOn(app, A, async (tx) => {
      const [row] = await tx.select().from(members).where(eq(members.id, roster[4].memberId));
      return row;
    });
    await submitEntry(app, as(repId), A, openId, body({ slots: [pickSlot(0), pickSlot(1), pickSlot(2), pickSlot(4)] }), NOW);
    const after = await withTenantOn(app, A, async (tx) => {
      const [row] = await tx.select().from(members).where(eq(members.id, roster[4].memberId));
      return row;
    });
    expect(after.entryCount).toBe(before.entryCount + 1);
    expect(after.lastEntryAt).not.toBeNull();
  });
});

describe("二重送信（§5.5「送信用のワンタイムの値」）", () => {
  it("同じ値で連打しても 1 件。戻って再送しても 2 件目はない", async () => {
    const input = body();
    // 別々の接続から同時に押す
    const [first, second] = await Promise.all([
      submitEntry(app, as(repId), A, openId, input, NOW),
      submitEntry(app2, as(repId), A, openId, input, NOW).catch((e: unknown) => e),
    ]);
    // 同時に押しても、あとから出す「戻る」からの再送でも、申込は 1 件
    const third = await submitEntry(app, as(repId), A, openId, input, NOW);
    expect(third.entryId).toBe(first.entryId);
    expect(third.alreadySubmitted).toBe(true);
    // 負けたほうは、失敗するか 1 件目と同じ申込を返すかのどちらか（2 件目は作られない）
    if (!(second instanceof Error)) expect((second as { entryId: string }).entryId).toBe(first.entryId);

    const rows = await withTenantOn(app, A, (tx) =>
      tx.select({ id: entries.id }).from(entries).where(eq(entries.submitToken, input.token as string)),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("締切と定員（§5.4）", () => {
  it("部門 A の締切だけ過ぎたら A は 409・B は成功", async () => {
    const id = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 部ごとの締切` }))).id;
    await addCategoriesFromPresets(app, as(adminId), A, id, { presetIds: [presetIds.m_free, presetIds.m_60] });
    const cats = await categoriesOf(id);
    await editCategory(app, as(adminId), A, id, cats.m_free, {
      label: "男子フリーの部",
      entryEndDate: "2026-09-10", // 過ぎている
      ageReferenceDate: "",
      maxEntries: "",
    });

    expect(await statusOf(() => submitEntry(app, as(repId), A, id, body({ categoryId: cats.m_free }), NOW))).toBe(409);
    // 60 歳以上の部は年齢で弾かれるので、締切そのものが通ることだけを見る
    const closed = await submitEntry(app, as(repId), A, id, body({ categoryId: cats.m_60 }), NOW).catch((e: unknown) => e);
    expect(closed).toBeInstanceOf(TeamError);
    if (closed instanceof TeamError) expect(closed.message).toContain("60歳以上");

    // 管理者は締切後でも申し込める（§3.2）
    expect(await statusOf(() => submitEntry(app, as(adminId), A, id, body({ categoryId: cats.m_free }), NOW))).toBe("ok");
  });

  it("上限 1 件の部に 2 件で 1 件だけ成功。管理者は超えられる（§5.4 v0.9.1）", async () => {
    const id = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 定員` }))).id;
    await addCategoriesFromPresets(app, as(adminId), A, id, { presetIds: [presetIds.m_free] });
    const cats = await categoriesOf(id);
    await editCategory(app, as(adminId), A, id, cats.m_free, {
      label: "男子フリーの部",
      entryEndDate: "",
      ageReferenceDate: "",
      maxEntries: "1",
    });

    // 別々の接続から同時に申し込む（大会の行のロックで 1 件ずつ処理される・§5.4）
    const results = await Promise.all([
      submitEntry(app, as(repId), A, id, body({ categoryId: cats.m_free }), NOW).catch((e: unknown) => e),
      submitEntry(app2, as(rep2Id), A, id, body({ teamId: team2Id, categoryId: cats.m_free }), NOW).catch((e: unknown) => e),
    ]);
    const ok = results.filter((r) => !(r instanceof Error));
    const rejected = results.filter((r): r is TeamError => r instanceof TeamError);
    expect(ok).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].status).toBe(409);
    expect(rejected[0].message).toContain("定員");

    // テナント管理者は上限を超えて登録できる
    expect(await statusOf(() => submitEntry(app, as(adminId), A, id, body({ categoryId: cats.m_free }), NOW))).toBe("ok");
  });
});

describe("警告と運営の確認対象の印（§5.5）", () => {
  it("同じ人を同じ大会の別の部に別チームから入れると警告が出て送信は成功し、印は立たない", async () => {
    const id = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 重複` }))).id;
    await addCategoriesFromPresets(app, as(adminId), A, id, { presetIds: [presetIds.m_free, presetIds.m_60] });
    const cats = await categoriesOf(id);

    const first = await submitEntry(app, as(repId), A, id, body({ categoryId: cats.m_free }), NOW);
    expect(first.warnings).toEqual([]);
    expect(first.needsAdminCheck).toBe(false);

    // 別チームの代表者が、同じ人を選手一覧に入れて同じ大会の別の部へ
    // （前の申込が成功していれば自動で加わっているので、すでにいる場合の 409 は無視する・§5.5(c) 4）
    for (const index of [0, 1, 2, 3]) {
      const p = roster[index];
      await addPlayer(app, as(rep2Id), A, team2Id, { name: p.name, kana: p.kana, birthDate: p.birthDate, sex: p.sex }).catch(
        (error: unknown) => {
          if (!(error instanceof TeamError) || error.status !== 409) throw error;
        },
      );
    }
    const second = await submitEntry(app, as(rep2Id), A, id, body({ teamId: team2Id, teamName: `${tag} つばき`, categoryId: cats.m_free }), NOW);
    expect(second.warnings.some((w) => w.kind === "duplicate_player")).toBe(true);
    expect(second.needsAdminCheck).toBe(false);
  });

  it("同じチームが同じ部に 2 件目を出すと警告（送信は止めない）", async () => {
    const id = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 同じ部` }))).id;
    await addCategoriesFromPresets(app, as(adminId), A, id, { presetIds: [presetIds.m_free] });
    const cats = await categoriesOf(id);
    await submitEntry(app, as(repId), A, id, body({ categoryId: cats.m_free }), NOW);
    const second = await submitEntry(app, as(repId), A, id, body({ categoryId: cats.m_free }), NOW);
    expect(second.warnings.some((w) => w.kind === "same_category")).toBe(true);
  });

  it("合計年齢の部は印が立つ（§5.5(e)）。男子だけでは混合の部に出せない", async () => {
    // 男子だけの登録は混合の部の編成が組めない（エラー・§5.5(e)）
    expect(await statusOf(() => submitEntry(app, as(repId), A, openId, body({ categoryId: categoryIds.x_160 }), NOW))).toBe(409);

    // 男女を混ぜれば送信でき、運営の確認対象の印が立つ
    const mixed = await submitEntry(
      app,
      as(repId),
      A,
      openId,
      body({ categoryId: categoryIds.x_160, slots: [pickSlot(0), pickSlot(1), pickSlot(5), pickSlot(6)] }),
      NOW,
    );
    expect(mixed.needsAdminCheck).toBe(true);
    const [row] = await withTenantOn(app, A, (tx) => tx.select().from(entries).where(eq(entries.id, mixed.entryId)));
    expect(row.needsAdminCheck).toBe(true);
  });

  it("手入力が名寄せで要確認になったら印が立つ（§8.3 ルール 1a）", async () => {
    const declined = manualSlot({ name: `${tag} アキラ`, kana: "あきら", birthDate: "1991-01-01", declinedSameName: true });
    const result = await submitEntry(app, as(repId), A, openId, body({ slots: [pickSlot(0), pickSlot(1), pickSlot(2), declined] }), NOW);
    expect(result.needsAdminCheck).toBe(true);
  });
});

describe("拒否（§5.5「バリデーション」・§3.1）", () => {
  it("そのチームの代表者でなければ 403", async () => {
    expect(await statusOf(() => submitEntry(app, as(rep2Id), A, openId, body(), NOW))).toBe(403);
  });

  it("未ログインは 403・でたらめな大会は 404・部が違う大会のものなら 404", async () => {
    expect(await statusOf(() => submitEntry(app, ANONYMOUS, A, openId, body(), NOW))).toBe(403);
    expect(await statusOf(() => submitEntry(app, as(repId), A, "こわれた-id", body(), NOW))).toBe(404);
    expect(await statusOf(() => submitEntry(app, as(repId), A, openId, body({ categoryId: crypto.randomUUID() }), NOW))).toBe(404);
  });

  it("人数が下限に足りない・上限を超えると 400", async () => {
    expect(await statusOf(() => submitEntry(app, as(repId), A, openId, body({ slots: [pickSlot(0)] }), NOW))).toBe(400);
  });

  it("同じ申込の中に同じ人が 2 回いたら 400", async () => {
    const slots = [pickSlot(0), pickSlot(1), pickSlot(2), pickSlot(0)];
    // 枠の検査（二重選択）で先に止まる
    expect(await statusOf(() => submitEntry(app, as(repId), A, openId, body({ slots }), NOW))).toBe(400);
  });

  it("部の条件を満たさなければ 409（§5.5(e)）", async () => {
    expect(await statusOf(() => submitEntry(app, as(repId), A, openId, body({ categoryId: categoryIds.m_60 }), NOW))).toBe(409);
  });
});

describe("申込完了メールの本文（§5.7・§11）", () => {
  it("申込番号・部・チーム名・選手名・変更のための URL を出し、生年月日は載せない", async () => {
    const result = await submitEntry(app, as(repId), A, openId, body(), NOW);
    const mail = await withTenantOn(app, A, (tx) =>
      composeMail(
        "entry_completed",
        { entryId: result.entryId },
        { associationName: `${tag} 協会`, associationSlug: "sub-test", baseUrl: "https://example.test" },
        tx,
      ),
    );
    expect(mail.subject).toContain(`${tag} 協会`);
    expect(mail.text).toContain(result.entryId);
    expect(mail.text).toContain("男子フリーの部");
    expect(mail.text).toContain(`${tag} さくら`);
    expect(mail.text).toContain(`${tag} アキラ`);
    expect(mail.text).toContain(`https://example.test/sub-test/entries/${result.entryId}`);
    // 生年月日・年齢・性別は載せない（§5.7）
    expect(mail.text).not.toContain("1975");
    expect(mail.text).not.toContain("51歳");
  });
});

describe("申込の参照（§5.7・§3.2）", () => {
  it("代表者には年齢・性別まで見える。ほかのチームの代表者は 403", async () => {
    const result = await submitEntry(app, as(repId), A, openId, body(), NOW);
    const detail = await getEntryDetail(app, as(repId), A, result.entryId);
    expect(detail.teamName).toBe(`${tag} さくら`);
    expect(detail.players).toHaveLength(4);
    expect(detail.players[0].personal?.age).toBe(51);
    expect(detail.canManage).toBe(true);

    expect(await statusOf(() => getEntryDetail(app, as(rep2Id), A, result.entryId))).toBe(403);
    expect(await statusOf(() => getEntryDetail(app, ANONYMOUS, A, result.entryId))).toBe(403);
    expect(await statusOf(() => getEntryDetail(app, as(repId), A, crypto.randomUUID()))).toBe(404);
  });

  it("締切前の申込が残っていると、チームの無効化に使う件数が 1 以上になる（§5.11）", async () => {
    const count = await withTenantOn(app, A, (tx) => countOpenEntries(tx, A, teamId, NOW));
    expect(count).toBeGreaterThan(0);
  });
});
