import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, categoryPresets, mailLogs, members, teams, tournaments, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { addCategoriesFromPresets, getCategoriesForAdmin } from "@/lib/admin/categories";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { backupClosedTournamentEntries, entryBackupKey } from "@/lib/jobs/entry-backup";
import type { PlayerSlot } from "@/lib/entries/player-slots";
import { submitEntry } from "@/lib/entries/submit-entry";
import { decryptBackup, generateBackupKeyPair } from "@/lib/storage/encrypt";
import type { StorageAdapter, StorageBucket } from "@/lib/storage/types";
import { addPlayer } from "@/lib/teams/roster";
import { registerTeam } from "@/lib/teams/teams";

// 日次ジョブ ②「締切後の申込一覧 CSV のバックアップ」（設計書 §5.5(f)・§6.5.1・B-14）
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `控え${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });
// 申し込む「今」と、ジョブが動く「今」（締切後）
const ENTRY_NOW = new Date("2026-09-20T03:00:00Z");
const AFTER_DEADLINE = new Date("2026-10-05T18:00:00Z"); // 日本時間 10/6 3:00
const AFTER_EVENT = new Date("2026-11-26T18:00:00Z"); // 開催日（11/23）の 4 日後

// 中身を確かめるための、その場かぎりの保存先
function memoryStorage(): StorageAdapter & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const at = (bucket: StorageBucket, key: string) => `${bucket}/${key}`;
  return {
    files,
    driver: "local",
    async put(bucket, key, body) {
      files.set(at(bucket, key), body);
    },
    async get(bucket, key) {
      return files.get(at(bucket, key)) ?? null;
    },
    async head(bucket, key) {
      const body = files.get(at(bucket, key));
      return body ? { contentType: null, contentDisposition: null, cacheControl: null, size: body.byteLength } : null;
    },
    async remove(bucket, key) {
      files.delete(at(bucket, key));
    },
    async list(bucket, prefix) {
      return [...files.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}`)).map((k) => k.slice(bucket.length + 1));
    },
    publicUrl: (key) => `http://localhost:3000/dev-files/${key}`,
  };
}

const keys = generateBackupKeyPair();
let A = "";
let adminId = "";
let repId = "";
let teamId = "";
let closedId = "";
let openId = "";
const presetIds: Record<string, string> = {};
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

const slots = (): PlayerSlot[] =>
  roster.map((p) => ({ kind: "pick", memberId: p.memberId, name: p.name, kana: p.kana, birthDate: p.birthDate, sex: p.sex }));

beforeAll(async () => {
  process.env.BACKUP_ENCRYPTION_KEY = keys.publicKey;

  const made = await owner
    .insert(users)
    .values([
      { email: `bk-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `bk-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId] = made.map((u) => u.id);

  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `bk-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));
  await withTenantOn(owner, A, async (tx) => {
    const rows = await tx
      .insert(categoryPresets)
      .values([{ associationId: A, code: "m_free", labelDefault: "男子フリーの部", gender: "male", ruleType: "free", sortOrder: 10 }])
      .returning({ id: categoryPresets.id, code: categoryPresets.code });
    for (const row of rows) presetIds[row.code] = row.id;
  });

  teamId = (await registerTeam(app, A, repId, { name: `${tag} さくら`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false })).id;
  for (const p of [
    { name: `${tag} アキラ`, kana: "あきら", birthDate: "1975-04-01", sex: "male" as const },
    { name: `${tag} イサム`, kana: "いさむ", birthDate: "1978-05-02", sex: "male" as const },
    { name: `${tag} ウシオ`, kana: "うしお", birthDate: "1980-06-03", sex: "male" as const },
    { name: `${tag} エイジ`, kana: "えいじ", birthDate: "1982-07-04", sex: "male" as const },
  ]) {
    const { memberId } = await addPlayer(app, as(repId), A, teamId, p);
    roster.push({ memberId, ...p });
  }

  // 締切を過ぎる大会と、締切が先の大会
  closedId = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 締切後` }))).id;
  openId = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 受付中`, entryEndDate: "2026-12-20" }))).id;
  for (const id of [closedId, openId]) {
    await addCategoriesFromPresets(app, as(adminId), A, id, { presetIds: [presetIds.m_free] });
    const view = await getCategoriesForAdmin(app, as(adminId), A, id);
    await submitEntry(
      app,
      as(repId),
      A,
      id,
      {
        teamId,
        newTeamName: "",
        teamName: `${tag} さくら`,
        categoryId: view.categories[0].id,
        slots: slots(),
        note: "",
        token: crypto.randomUUID(),
      },
      ENTRY_NOW,
    );
  }
}, 60_000);

afterAll(async () => {
  delete process.env.BACKUP_ENCRYPTION_KEY;
  await owner.delete(mailLogs).where(eq(mailLogs.associationId, A));
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(members).where(eq(members.associationId, A));
    await tx.delete(teams).where(eq(teams.associationId, A));
    await tx.delete(categoryPresets).where(eq(categoryPresets.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
  });
  await owner.delete(associations).where(eq(associations.id, A));
  await owner.delete(users).where(inArray(users.id, [adminId, repId]));
  await closeDb(owner);
  await closeDb(app);
  await closeDb(job);
});

describe("締切後の申込一覧 CSV のバックアップ", () => {
  it("締切を過ぎた大会だけ、暗号化した CSV を保存する（生年月日は含めない）", async () => {
    const storage = memoryStorage();
    await backupClosedTournamentEntries(job, storage, AFTER_DEADLINE);

    const key = entryBackupKey(A, closedId, { year: 2026, month: 10, day: 6 });
    const sealed = storage.files.get(`backup/${key}`);
    expect(sealed).toBeDefined();
    if (!sealed) return;
    // そのままでは中身が読めない
    expect(new TextDecoder().decode(sealed)).not.toContain(`${tag} さくら`);

    // TextDecoder は既定で BOM を落とすので、BOM を確かめるときは ignoreBOM を付ける
    const csv = new TextDecoder("utf-8", { ignoreBOM: true }).decode(decryptBackup(keys.privateKey, sealed));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain(`${tag} さくら`);
    expect(csv).toContain(`${tag} アキラ`);
    expect(csv).not.toContain("生年月日");
    expect(csv).not.toContain("1975-04-01");

    // 受付中の大会は作らない
    expect([...storage.files.keys()].some((k) => k.includes(openId))).toBe(false);
  });

  it("開催日の翌日を過ぎたら作らない", async () => {
    const storage = memoryStorage();
    await backupClosedTournamentEntries(job, storage, AFTER_EVENT);
    expect([...storage.files.keys()].some((k) => k.includes(closedId))).toBe(false);
  });

  it("同じ日に 2 回流しても増えない（同じ名前で上書き）", async () => {
    // ほかのテストの協会の分は数えない（同時に流れていると増えることがある）
    const mine = (storage: ReturnType<typeof memoryStorage>) =>
      [...storage.files.keys()].filter((key) => key.startsWith(`backup/entries/${A}/`));
    const storage = memoryStorage();
    await backupClosedTournamentEntries(job, storage, AFTER_DEADLINE);
    const first = mine(storage);
    expect(first).toHaveLength(1);
    await backupClosedTournamentEntries(job, storage, AFTER_DEADLINE);
    expect(mine(storage)).toEqual(first);
  });
});
