import { TransactionRollbackError, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import {
  associations,
  categoryPresets,
  contactMessages,
  entries,
  entryAudits,
  entryPlayers,
  mailLogs,
  members,
  memberships,
  membershipDeclarations,
  membershipPeriods,
  teams,
  tournamentCategories,
  tournaments,
  users,
} from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { setTenant, type Tx } from "@/db/tenant";

// 大会・申込・会員の表の制約のテスト（B-01。設計書 §12.1「DB の制約」・§7.0）
// constraints.test.ts と同じ形: app_owner で接続し、1 つのトランザクションの中で行って最後に戻す
// 失敗させる INSERT は savepoint（入れ子の transaction）の中で行い、外のトランザクションを壊さない
const db = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
afterAll(() => closeDb(db));

const FK_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  return run().then(
    () => "ok",
    (error: unknown) => pgErrorCode(error) ?? String(error),
  );
}

async function withRollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      tx.rollback();
    });
  } catch (error) {
    if (!(error instanceof TransactionRollbackError)) throw error;
  }
}

const random = () => `t-${Math.random().toString(36).slice(2, 10)}`;

async function createAssociation(tx: Tx, name: string): Promise<string> {
  const [row] = await tx.insert(associations).values({ name, slug: random() }).returning({ id: associations.id });
  return row.id;
}

async function createUser(tx: Tx): Promise<string> {
  const [row] = await tx.insert(users).values({ email: `${random()}@example.com` }).returning({ id: users.id });
  return row.id;
}

async function createTeam(tx: Tx, associationId: string): Promise<string> {
  await setTenant(tx, associationId);
  const [row] = await tx
    .insert(teams)
    .values({ associationId, name: `チーム ${random()}` })
    .returning({ id: teams.id });
  return row.id;
}

async function createMember(tx: Tx, associationId: string): Promise<string> {
  await setTenant(tx, associationId);
  const [row] = await tx
    .insert(members)
    .values({ associationId, name: "早良太郎", birthDate: "1990-04-01", sex: "male", nameNormalized: "早良太郎" })
    .returning({ id: members.id });
  return row.id;
}

async function createPreset(tx: Tx, associationId: string): Promise<string> {
  await setTenant(tx, associationId);
  const [row] = await tx
    .insert(categoryPresets)
    .values({ associationId, code: random(), labelDefault: "男子自由の部", gender: "male", ruleType: "free" })
    .returning({ id: categoryPresets.id });
  return row.id;
}

async function createTournament(tx: Tx, associationId: string): Promise<string> {
  await setTenant(tx, associationId);
  const [row] = await tx
    .insert(tournaments)
    .values({
      associationId,
      name: `大会 ${random()}`,
      ageReferenceDate: "2026-11-01",
      entryEndAt: new Date("2026-10-01T14:59:59Z"), // 日本時間 2026-09-30 23:59:59
    })
    .returning({ id: tournaments.id });
  return row.id;
}

async function createCategory(tx: Tx, associationId: string, tournamentId: string, presetId: string): Promise<string> {
  await setTenant(tx, associationId);
  const [row] = await tx
    .insert(tournamentCategories)
    .values({ associationId, tournamentId, presetId, code: random(), label: "男子自由の部" })
    .returning({ id: tournamentCategories.id });
  return row.id;
}

type EntryParts = { tournamentId: string; categoryId: string; teamId: string; createdBy: string };

async function createEntry(tx: Tx, associationId: string, parts: EntryParts): Promise<string> {
  await setTenant(tx, associationId);
  const [row] = await tx
    .insert(entries)
    .values({ associationId, ...parts, teamName: "チーム A" })
    .returning({ id: entries.id });
  return row.id;
}

// 早良区協会に、大会・部門・チーム・申込まで一式そろえる
async function createFixture(tx: Tx) {
  const association = SAWARA_ASSOCIATION_ID;
  const createdBy = await createUser(tx);
  const teamId = await createTeam(tx, association);
  const presetId = await createPreset(tx, association);
  const tournamentId = await createTournament(tx, association);
  const categoryId = await createCategory(tx, association, tournamentId, presetId);
  const entryId = await createEntry(tx, association, { tournamentId, categoryId, teamId, createdBy });
  return { association, createdBy, teamId, presetId, tournamentId, categoryId, entryId };
}

describe("複合外部キー（別の協会の親を指せない・§7.0）", () => {
  it("tournament_categories: 別の協会の大会・プリセットを指す INSERT は DB で失敗する", () =>
    withRollback(async (tx) => {
      const other = await createAssociation(tx, "別の協会");
      const sawaraTournament = await createTournament(tx, SAWARA_ASSOCIATION_ID);
      const sawaraPreset = await createPreset(tx, SAWARA_ASSOCIATION_ID);
      const otherTournament = await createTournament(tx, other);
      const otherPreset = await createPreset(tx, other);

      // 早良の大会に、別の協会のプリセット
      await setTenant(tx, SAWARA_ASSOCIATION_ID);
      expect(
        await outcome(() =>
          tx.transaction((sp) =>
            sp.insert(tournamentCategories).values({
              associationId: SAWARA_ASSOCIATION_ID,
              tournamentId: sawaraTournament,
              presetId: otherPreset,
              code: random(),
              label: "男子自由の部",
            }),
          ),
        ),
      ).toBe(FK_VIOLATION);
      // 早良の協会の行として、別の協会の大会
      expect(
        await outcome(() =>
          tx.transaction((sp) =>
            sp.insert(tournamentCategories).values({
              associationId: SAWARA_ASSOCIATION_ID,
              tournamentId: otherTournament,
              presetId: sawaraPreset,
              code: random(),
              label: "男子自由の部",
            }),
          ),
        ),
      ).toBe(FK_VIOLATION);
      // 協会の欄だけ嘘（早良の大会とプリセットを、別の協会の行として入れる）
      await setTenant(tx, other);
      expect(
        await outcome(() =>
          tx.transaction((sp) =>
            sp.insert(tournamentCategories).values({
              associationId: other,
              tournamentId: sawaraTournament,
              presetId: sawaraPreset,
              code: random(),
              label: "男子自由の部",
            }),
          ),
        ),
      ).toBe(FK_VIOLATION);
      // 正しい組み合わせは通る
      expect(await outcome(() => createCategory(tx, other, otherTournament, otherPreset))).toBe("ok");
    }));

  it("entries: 別の協会の大会・部門・チームを指す INSERT は DB で失敗する", () =>
    withRollback(async (tx) => {
      const f = await createFixture(tx);
      const other = await createAssociation(tx, "別の協会");
      const otherTeam = await createTeam(tx, other);
      const otherTournament = await createTournament(tx, other);
      const otherCategory = await createCategory(tx, other, otherTournament, await createPreset(tx, other));

      await setTenant(tx, SAWARA_ASSOCIATION_ID);
      const base = { associationId: SAWARA_ASSOCIATION_ID, ...f, teamName: "チーム A" };
      for (const bad of [
        { tournamentId: otherTournament },
        { categoryId: otherCategory },
        { teamId: otherTeam },
      ]) {
        expect(
          await outcome(() =>
            tx.transaction((sp) =>
              sp.insert(entries).values({ ...base, ...bad, associationId: SAWARA_ASSOCIATION_ID }),
            ),
          ),
        ).toBe(FK_VIOLATION);
      }
      // 協会の欄だけ嘘（早良の大会・部門・チームを、別の協会の行として入れる）
      await setTenant(tx, other);
      expect(
        await outcome(() => tx.transaction((sp) => sp.insert(entries).values({ ...base, associationId: other }))),
      ).toBe(FK_VIOLATION);
    }));

  it("entry_players・memberships: 別の協会の申込・人物・チームを指す INSERT は DB で失敗する", () =>
    withRollback(async (tx) => {
      const f = await createFixture(tx);
      const other = await createAssociation(tx, "別の協会");
      const otherMember = await createMember(tx, other);
      const otherTeam = await createTeam(tx, other);
      const sawaraMember = await createMember(tx, SAWARA_ASSOCIATION_ID);

      await setTenant(tx, SAWARA_ASSOCIATION_ID);
      const player = {
        associationId: SAWARA_ASSOCIATION_ID,
        entryId: f.entryId,
        position: 1,
        name: "早良太郎",
        sex: "male" as const,
        nameNormalized: "早良太郎",
      };
      // 早良の申込に、別の協会の人物
      expect(
        await outcome(() => tx.transaction((sp) => sp.insert(entryPlayers).values({ ...player, memberId: otherMember }))),
      ).toBe(FK_VIOLATION);
      expect(await outcome(() => tx.insert(entryPlayers).values({ ...player, memberId: sawaraMember }))).toBe("ok");

      // 会員資格: 早良の人物に、別の協会のチーム
      expect(
        await outcome(() =>
          tx.transaction((sp) =>
            sp
              .insert(memberships)
              .values({
                associationId: SAWARA_ASSOCIATION_ID,
                memberId: sawaraMember,
                teamId: otherTeam,
                year: 2026,
                status: "approved",
              }),
          ),
        ),
      ).toBe(FK_VIOLATION);
      expect(
        await outcome(() =>
          tx
            .insert(memberships)
            .values({
              associationId: SAWARA_ASSOCIATION_ID,
              memberId: sawaraMember,
              teamId: f.teamId,
              year: 2026,
              status: "approved",
            }),
        ),
      ).toBe("ok");

      // 申告の記録も同じ（別の協会のチーム）
      expect(
        await outcome(() =>
          tx.transaction((sp) =>
            sp
              .insert(membershipDeclarations)
              .values({ associationId: SAWARA_ASSOCIATION_ID, teamId: otherTeam, year: 2026 }),
          ),
        ),
      ).toBe(FK_VIOLATION);
    }));
});

describe("CHECK 制約（1 つの表の中で完結する整合性・§5.4）", () => {
  it("tournaments: チーム人数の下限 ≦ 上限、申込上限は 1 以上、申込開始 < 締切、状態は 4 つ", () =>
    withRollback(async (tx) => {
      await setTenant(tx, SAWARA_ASSOCIATION_ID);
      const base = {
        associationId: SAWARA_ASSOCIATION_ID,
        name: "大会",
        ageReferenceDate: "2026-11-01",
        entryEndAt: new Date("2026-10-01T14:59:59Z"),
      };
      const insert = (values: Partial<typeof tournaments.$inferInsert>) =>
        outcome(() => tx.transaction((sp) => sp.insert(tournaments).values({ ...base, ...values })));

      expect(await insert({ teamSizeMin: 8, teamSizeMax: 7 })).toBe(CHECK_VIOLATION);
      expect(await insert({ teamSizeMin: 0, teamSizeMax: 7 })).toBe(CHECK_VIOLATION);
      expect(await insert({ maxEntries: 0 })).toBe(CHECK_VIOLATION);
      expect(await insert({ entryStartAt: new Date("2026-10-02T00:00:00Z") })).toBe(CHECK_VIOLATION);
      expect(await insert({ status: "published" as never })).toBe(CHECK_VIOLATION);

      // 下限 = 上限・上限なし・同じ日に開始と締切は通る
      expect(await insert({ teamSizeMin: 4, teamSizeMax: 4 })).toBe("ok");
      expect(await insert({ maxEntries: null })).toBe("ok");
      expect(await insert({ entryStartAt: new Date("2026-09-01T15:00:00Z"), status: "open" })).toBe("ok");
    }));

  it("tournament_categories・entry_players・entry_audits・memberships・membership_periods の値の範囲", () =>
    withRollback(async (tx) => {
      const f = await createFixture(tx);
      const member = await createMember(tx, SAWARA_ASSOCIATION_ID);
      await setTenant(tx, SAWARA_ASSOCIATION_ID);
      const sp = <T>(run: (tx: Tx) => Promise<T>) => outcome(() => tx.transaction((inner) => run(inner)));

      // 部門ごとの申込上限も 1 以上
      expect(
        await sp((inner) =>
          inner.insert(tournamentCategories).values({
            associationId: f.association,
            tournamentId: f.tournamentId,
            presetId: f.presetId,
            code: random(),
            label: "男子自由の部",
            maxEntries: 0,
          }),
        ),
      ).toBe(CHECK_VIOLATION);

      const player = {
        associationId: f.association,
        entryId: f.entryId,
        position: 1,
        name: "早良太郎",
        nameNormalized: "早良太郎",
        memberId: member,
      };
      expect(await sp((inner) => inner.insert(entryPlayers).values({ ...player, sex: "other" as never }))).toBe(
        CHECK_VIOLATION,
      );
      expect(
        await sp((inner) =>
          inner.insert(entryPlayers).values({ ...player, sex: "male", matchType: "guessed" as never }),
        ),
      ).toBe(CHECK_VIOLATION);
      // 同じ申込の同じ枠は 1 人
      expect(await outcome(() => tx.insert(entryPlayers).values({ ...player, sex: "male" }))).toBe("ok");
      expect(await sp((inner) => inner.insert(entryPlayers).values({ ...player, sex: "male" }))).toBe(UNIQUE_VIOLATION);

      expect(
        await sp((inner) =>
          inner
            .insert(entryAudits)
            .values({ associationId: f.association, entryId: f.entryId, action: "deleted" as never }),
        ),
      ).toBe(CHECK_VIOLATION);

      const membership = { associationId: f.association, memberId: member, year: 2026 };
      expect(await sp((inner) => inner.insert(memberships).values({ ...membership, status: "paid" as never }))).toBe(
        CHECK_VIOLATION,
      );
      expect(
        await sp((inner) =>
          inner.insert(memberships).values({ ...membership, status: "approved", source: "manual" as never }),
        ),
      ).toBe(CHECK_VIOLATION);

      // 年度更新の受付は開始 < 締切
      expect(
        await sp((inner) =>
          inner.insert(membershipPeriods).values({
            associationId: f.association,
            year: 2026,
            opensAt: new Date("2026-04-01T00:00:00Z"),
            closesAt: new Date("2026-03-01T00:00:00Z"),
          }),
        ),
      ).toBe(CHECK_VIOLATION);
    }));
});

describe("部分一意インデックス（削除済みと同じ内容で登録し直せる・§5.16）", () => {
  it("tournament_categories: 同じ大会に同じ code は 1 つ。削除したら作り直せる", () =>
    withRollback(async (tx) => {
      const f = await createFixture(tx);
      await setTenant(tx, SAWARA_ASSOCIATION_ID);
      const row = {
        associationId: f.association,
        tournamentId: f.tournamentId,
        presetId: f.presetId,
        code: "m_free",
        label: "男子自由の部",
      };
      const [first] = await tx.insert(tournamentCategories).values(row).returning({ id: tournamentCategories.id });
      expect(await outcome(() => tx.transaction((sp) => sp.insert(tournamentCategories).values(row)))).toBe(
        UNIQUE_VIOLATION,
      );
      // 別の大会なら同じ code を使える
      const another = await createTournament(tx, f.association);
      await setTenant(tx, f.association);
      expect(await outcome(() => tx.insert(tournamentCategories).values({ ...row, tournamentId: another }))).toBe("ok");

      await tx.update(tournamentCategories).set({ deletedAt: new Date() }).where(eq(tournamentCategories.id, first.id));
      expect(await outcome(() => tx.insert(tournamentCategories).values(row))).toBe("ok");
    }));

  it("memberships: 1 人 1 年度に 1 行。削除したら申告し直せる", () =>
    withRollback(async (tx) => {
      const f = await createFixture(tx);
      const member = await createMember(tx, SAWARA_ASSOCIATION_ID);
      await setTenant(tx, SAWARA_ASSOCIATION_ID);
      const row = { associationId: f.association, memberId: member, year: 2026, status: "approved" as const };

      const [first] = await tx.insert(memberships).values(row).returning({ id: memberships.id });
      expect(await outcome(() => tx.transaction((sp) => sp.insert(memberships).values(row)))).toBe(UNIQUE_VIOLATION);
      // 別の年度は入れられる
      expect(await outcome(() => tx.insert(memberships).values({ ...row, year: 2027 }))).toBe("ok");

      await tx.update(memberships).set({ deletedAt: new Date() }).where(eq(memberships.id, first.id));
      expect(await outcome(() => tx.insert(memberships).values(row))).toBe("ok");
    }));
});

describe("列を指定した ON DELETE SET NULL（親を物理削除しても記録は残す・§5.16）", () => {
  it("人物を物理削除すると entry_players.member_id だけ NULL になる", () =>
    withRollback(async (tx) => {
      const f = await createFixture(tx);
      const member = await createMember(tx, SAWARA_ASSOCIATION_ID);
      await setTenant(tx, SAWARA_ASSOCIATION_ID);
      await tx.insert(entryPlayers).values({
        associationId: f.association,
        entryId: f.entryId,
        position: 1,
        name: "早良太郎",
        sex: "male",
        nameNormalized: "早良太郎",
        memberId: member,
        matchType: "picked",
      });

      await tx.delete(members).where(eq(members.id, member));
      const rows = await tx
        .select({ memberId: entryPlayers.memberId, name: entryPlayers.name })
        .from(entryPlayers)
        .where(eq(entryPlayers.entryId, f.entryId));
      expect(rows).toEqual([{ memberId: null, name: "早良太郎" }]);
    }));

  it("チームを物理削除すると memberships.team_id だけ NULL になる", () =>
    withRollback(async (tx) => {
      const association = SAWARA_ASSOCIATION_ID;
      const teamId = await createTeam(tx, association);
      const member = await createMember(tx, association);
      await setTenant(tx, association);
      await tx.insert(memberships).values({ associationId: association, memberId: member, teamId, year: 2026, status: "approved" });

      await tx.delete(teams).where(eq(teams.id, teamId));
      const rows = await tx
        .select({ teamId: memberships.teamId, year: memberships.year })
        .from(memberships)
        .where(eq(memberships.memberId, member));
      expect(rows).toEqual([{ teamId: null, year: 2026 }]);
    }));

  it("申込を物理削除すると contact_messages.entry_id と mail_logs.entry_id が NULL になる", () =>
    withRollback(async (tx) => {
      const f = await createFixture(tx);
      await setTenant(tx, f.association);
      const [contact] = await tx
        .insert(contactMessages)
        .values({
        associationId: f.association,
        tournamentId: f.tournamentId,
        entryId: f.entryId,
        subjectType: "変更",
        senderName: "早良太郎",
        senderEmail: "taro@example.com",
        body: "申込の変更をお願いします",
        })
        .returning({ id: contactMessages.id });
      const [mail] = await tx
        .insert(mailLogs)
        .values({ associationId: f.association, mailType: "entry_received", toEmail: "taro@example.com", entryId: f.entryId })
        .returning({ id: mailLogs.id });

      await tx.delete(entries).where(eq(entries.id, f.entryId));
      const contacts = await tx
        .select({ entryId: contactMessages.entryId, tournamentId: contactMessages.tournamentId })
        .from(contactMessages)
        .where(eq(contactMessages.id, contact.id));
      expect(contacts).toEqual([{ entryId: null, tournamentId: f.tournamentId }]);
      const mails = await tx.select({ entryId: mailLogs.entryId }).from(mailLogs).where(eq(mailLogs.id, mail.id));
      expect(mails).toEqual([{ entryId: null }]);

      // 大会を消すと部門・申込は一緒に消え、問い合わせの大会も NULL になる
      await tx.delete(tournaments).where(eq(tournaments.id, f.tournamentId));
      const after = await tx
        .select({ entryId: contactMessages.entryId, tournamentId: contactMessages.tournamentId })
        .from(contactMessages)
        .where(eq(contactMessages.id, contact.id));
      expect(after).toEqual([{ entryId: null, tournamentId: null }]);
    }));
});

describe("RLS の付け忘れを機構で防ぐ（§5.14）", () => {
  // association_id を持つ表は、協会に属さない行も入る 2 つを除いてすべて RLS（enable + force + ポリシー 1 つ）
  const WITHOUT_RLS = ["admin_access_logs", "mail_logs"];

  it("association_id を持つ表はすべて RLS が有効でポリシーがある", async () => {
    const result = await db.execute(sql`
      select c.relname::text as table_name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
             (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and exists (select 1 from pg_attribute a
                      where a.attrelid = c.oid and a.attname = 'association_id' and a.attnum > 0 and not a.attisdropped)
       order by 1`);
    const rows = result.rows as { table_name: string; rls: boolean; forced: boolean; policies: number }[];

    // B-01 で足した 9 表が対象に入っていること（表を作り忘れていないかの確認も兼ねる）
    const names = rows.map((r) => r.table_name);
    for (const t of [
      "tournaments",
      "tournament_categories",
      "entries",
      "entry_players",
      "entry_audits",
      "export_logs",
      "memberships",
      "membership_periods",
      "membership_declarations",
    ]) {
      expect(names).toContain(t);
    }

    const missing = rows.filter(
      (r) => !WITHOUT_RLS.includes(r.table_name) && !(r.rls && r.forced && r.policies >= 1),
    );
    expect(missing).toEqual([]);
  });
});
