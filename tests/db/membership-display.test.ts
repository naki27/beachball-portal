import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associationAdmins,
  associations,
  entries,
  entryPlayers,
  mailLogs,
  members,
  membershipPeriods,
  memberships,
  teams,
  tournaments,
  users,
} from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { getAdminEntries, buildEntriesCsv } from "@/lib/admin/entries";
import { addCategoriesFromPresets } from "@/lib/admin/categories";
import { createPreset } from "@/lib/admin/category-presets";
import { openRenewalPeriod } from "@/lib/admin/memberships";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { getEntryFormData } from "@/lib/entries/entry-form";
import { getRoster } from "@/lib/teams/roster";
import { addPlayer } from "@/lib/teams/roster";
import { normalizeName } from "@/lib/normalize";
import { listTournamentCategories } from "@/lib/repo/tournament-categories";
import { registerTeam } from "@/lib/teams/teams";

// 協会員区分の表示（設計書 §5.12「表示」・D-05）
// 申込一覧・CSV は**大会の開催日の年度**で判定する。データのない年度は画面に出さず、CSV は空欄
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `表示${random()}`;

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

// 2027 年度の受付は日本時間 2027-04-01〜2027-06-30
const DURING = new Date("2027-05-10T00:00:00Z");

let A = "";
let adminId = "";
let repId = "";
let teamId = "";
let memberKeep = ""; // 2027 年度の承認済み
let memberRenew = ""; // 昨年度は会員・今年度はまだ
let memberNew = ""; // 会員ではない
// 4 月開催（2027 年度）と 3 月開催（2026 年度）の 2 大会
let aprilTournament = "";
let marchTournament = "";

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `dp-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `dp-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `dp-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));

  teamId = (
    await registerTeam(app, A, repId, {
      name: `${tag} チーム`,
      kana: null,
      contactEmail: null,
      contactPhone: null,
      membershipRenewalTarget: true,
    })
  ).id;

  const add = async (name: string, birthDate: string): Promise<string> => {
    const added = await addPlayer(app, as(repId), A, teamId, { name: `${tag} ${name}`, kana: "", birthDate, sex: "male" });
    return added.memberId;
  };
  memberKeep = await add("会員", "1988-01-02");
  memberRenew = await add("更新まち", "1989-03-04");
  memberNew = await add("非会員", "1995-06-07");

  // 昨年度（2026）の会員を 2 人
  await withTenantOn(owner, A, (tx) =>
    tx.insert(memberships).values([
      { associationId: A, memberId: memberKeep, teamId, year: 2026, status: "approved", source: "renewal" },
      { associationId: A, memberId: memberRenew, teamId, year: 2026, status: "approved", source: "renewal" },
    ]),
  );

  const preset = await createPreset(app, as(adminId), A, {
    code: `m_free_${random()}`,
    labelDefault: "男子フリーの部",
    gender: "male",
    ruleType: "free",
    courtSize: "4",
    mixedMinMale: "1",
    mixedMinFemale: "2",
    sortOrder: "10",
  });

  const base = {
    venue: "早良体育館",
    description: "",
    entryStartDate: "2027-01-05",
    teamSizeMin: "4",
    teamSizeMax: "7",
    maxEntries: "",
    status: "open",
  };
  aprilTournament = (
    await createTournament(app, as(adminId), A, {
      ...base,
      name: `${tag} 4月の大会`,
      eventDate: "2027-04-11",
      ageReferenceDate: "2027-04-11",
      // 申込の受付は 5 月末まで（「協会員だけを表示」を受付期間中に確かめるため）
      entryEndDate: "2027-05-31",
    })
  ).id;
  marchTournament = (
    await createTournament(app, as(adminId), A, {
      ...base,
      name: `${tag} 3月の大会`,
      eventDate: "2027-03-28",
      ageReferenceDate: "2027-03-28",
      entryEndDate: "2027-03-20",
    })
  ).id;
  for (const id of [aprilTournament, marchTournament]) {
    await addCategoriesFromPresets(app, as(adminId), A, id, { presetIds: [preset.id] });
  }

  // 申込を 1 件ずつ（表に直接入れる。申込の画面は B-09・B-10）
  for (const [tournamentId, label] of [
    [aprilTournament, "4月"],
    [marchTournament, "3月"],
  ] as const) {
    await withTenantOn(owner, A, async (tx) => {
      // 部は 1 つだけ
      const [category] = await listTournamentCategories(tx, A, tournamentId);
      const [entry] = await tx
        .insert(entries)
        .values({ associationId: A, tournamentId, categoryId: category.id, teamId, createdBy: repId, teamName: `${tag} ${label}` })
        .returning({ id: entries.id });
      await tx.insert(entryPlayers).values(
        [memberKeep, memberRenew, memberNew].map((memberId, index) => {
          const name = `${tag} 選手${index + 1}`;
          return {
            associationId: A,
            entryId: entry.id,
            memberId,
            position: index + 1,
            name,
            nameNormalized: normalizeName(name),
            birthDate: "1990-01-01",
            sex: "male" as const,
            ageAtEvent: 37,
          };
        }),
      );
    });
  }
});

afterAll(async () => {
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(memberships).where(eq(memberships.associationId, A));
    await tx.delete(membershipPeriods).where(eq(membershipPeriods.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, A));
  await owner.delete(associations).where(inArray(associations.id, [A]));
  await owner.delete(users).where(inArray(users.id, [adminId, repId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("受付も取り込みもない年度", () => {
  it("申込一覧に区分を出さず、CSV は空欄になる", async () => {
    const view = await getAdminEntries(app, as(adminId), A, aprilTournament, DURING);
    expect(view.year).toBe(2027);
    expect(view.hasMembershipData).toBe(false);
    expect(view.entries[0].players.map((p) => p.membershipLabel)).toEqual([null, null, null]);
    const csv = await withTenantOn(app, A, (tx) => buildEntriesCsv(tx, A, aprilTournament, 2027, { includeBirthDate: false, now: DURING }));
    // 「協会員区分」は 9 列目。列は残して空欄
    expect(csv.body.split("\r\n")[1].split(",")[8]).toBe("");
  });
});

describe("受付期間中", () => {
  it("昨年度の会員で今年度の申告がまだの人は「更新の受付中（昨年度は協会員）」", async () => {
    await openRenewalPeriod(app, as(adminId), A, { year: 2027, opensDate: "2027-04-01", closesDate: "2027-06-30" });
    // 1 人だけ 2027 年度の承認済みにする（更新まちの人は今年度の行を作らない）
    await withTenantOn(owner, A, (tx) =>
      tx.insert(memberships).values({
        associationId: A,
        memberId: memberKeep,
        teamId,
        year: 2027,
        status: "approved",
        source: "renewal",
        approvedBy: adminId,
        approvedAt: DURING,
      }),
    );

    const view = await getAdminEntries(app, as(adminId), A, aprilTournament, DURING);
    expect(view.hasMembershipData).toBe(true);
    expect(view.entries[0].players.map((p) => p.membershipLabel)).toEqual([
      "協会員（2027年度）",
      "更新の受付中（昨年度は協会員）",
      "協会員ではない",
    ]);
    const csv = await withTenantOn(app, A, (tx) => buildEntriesCsv(tx, A, aprilTournament, 2027, { includeBirthDate: false, now: DURING }));
    expect(csv.body.split("\r\n").slice(1, 4).map((line) => line.split(",")[8])).toEqual(["協会員", "更新の受付中", "非会員"]);
  });

  it("3 月開催の大会は 2026 年度で判定する（開催日の年度・§5.12）", async () => {
    const view = await getAdminEntries(app, as(adminId), A, marchTournament, DURING);
    expect(view.year).toBe(2026);
    // 2026 年度は受付も取り込みもないので、区分を出さない
    expect(view.entries[0].players.every((p) => p.membershipLabel === null)).toBe(true);
  });

  it("チーム管理の画面に今年度の状態が出る", async () => {
    const roster = await getRoster(app, as(repId), A, teamId, DURING);
    expect(roster.items.map((item) => item.membershipLabel)).toEqual([
      "協会員（2027年度）",
      "更新の受付中（昨年度は協会員）",
      "協会員ではない",
    ]);
  });

  it("申込の「協会員だけを表示」は、承認済みの人だけを協会員として扱う", async () => {
    const form = await getEntryFormData(app, as(repId), A, aprilTournament, DURING);
    expect(form.showMembersOnly).toBe(true);
    const flags = form.rosters[teamId].map((player) => [player.name, player.isMember]);
    // 承認済みの人だけが true（「更新の受付中」は会員ではない・付録 F）
    expect(flags).toEqual([
      [`${tag} 会員`, true],
      [`${tag} 更新まち`, false],
      [`${tag} 非会員`, false],
    ]);
  });
});
