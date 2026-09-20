import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, teams, tournamentDocuments, tournaments, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { getDocumentsForAdmin, editDocument, removeDocument, uploadDocument } from "@/lib/admin/documents";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { DOC_MAX_BYTES } from "@/lib/documents/document-input";
import { findPublicDocumentUrl } from "@/lib/public/tournaments";
import { createLocalStorage } from "@/lib/storage/local";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 大会資料のアップロードと保管（設計書 §5.9・C-01）。準備は app_owner、検査はアプリと同じ app_user で行う
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const root = mkdtempSync(join(tmpdir(), "bbp-docs-"));
const storage = createLocalStorage(root, "http://localhost:3000/dev-files");

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `資料${random()}`;

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);
const file = (over: Partial<{ name: string; contentType: string; bytes: Uint8Array }> = {}) => ({
  name: "大会冊子.pdf",
  contentType: "application/pdf",
  bytes: pdf(random()),
  ...over,
});
const fields = (over: Record<string, unknown> = {}) => ({ docType: "大会冊子", title: `${tag} 冊子`, sortOrder: "100", isPublic: "true", ...over });

async function statusOf(run: () => Promise<unknown>): Promise<"ok" | number> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

let A = "";
let B = "";
let adminId = "";
let repId = "";
let otherAdminId = "";
let tournamentId = "";
let otherTournamentId = "";

beforeAll(async () => {
  const made = await owner
    .insert(users)
    .values([
      { email: `doc-admin-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `doc-rep-${random()}@example.com`, emailVerifiedAt: new Date() },
      { email: `doc-other-${random()}@example.com`, emailVerifiedAt: new Date() },
    ])
    .returning({ id: users.id });
  [adminId, repId, otherAdminId] = made.map((u) => u.id);

  const rows = await owner
    .insert(associations)
    .values([
      { name: `${tag} 協会`, slug: `doc-a-${random()}` },
      { name: `${tag} 別協会`, slug: `doc-b-${random()}` },
    ])
    .returning({ id: associations.id });
  [A, B] = rows.map((r) => r.id);

  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));
  await withTenantOn(owner, B, (tx) => tx.insert(associationAdmins).values({ associationId: B, userId: otherAdminId }));

  // 代表者の 403 を確かめるため、この協会にチームを 1 つ作る
  await registerTeam(app, A, repId, {
    name: `${tag} チーム`,
    kana: null,
    contactEmail: null,
    contactPhone: null,
    membershipRenewalTarget: false,
  });

  const input = {
    name: `${tag} 大会`,
    eventDate: "2027-03-28",
    ageReferenceDate: "2027-03-28",
    venue: "早良体育館",
    description: "",
    entryStartDate: "2027-01-05",
    entryEndDate: "2027-02-28",
    teamSizeMin: "4",
    teamSizeMax: "7",
    maxEntries: "",
    status: "open",
  };
  tournamentId = (await createTournament(app, as(adminId), A, input)).id;
  otherTournamentId = (await createTournament(app, as(otherAdminId), B, { ...input, name: `${tag} 別大会` })).id;
});

afterAll(async () => {
  for (const id of [A, B]) {
    await withTenantOn(owner, id, async (tx) => {
      // 大会を消すと資料は cascade で消える
      await tx.delete(tournaments).where(eq(tournaments.associationId, id));
      await tx.delete(teams).where(eq(teams.associationId, id));
      await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, id));
    });
  }
  await owner.delete(associations).where(inArray(associations.id, [A, B]));
  await owner.delete(users).where(inArray(users.id, [adminId, repId, otherAdminId]));
  await closeDb(owner);
  await closeDb(app);
  rmSync(root, { recursive: true, force: true });
});

describe("アップロード", () => {
  it("PDF を保管用に置き、一覧に出る", async () => {
    const body = pdf("冊子");
    const { documentId } = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 要項`, docType: "要項" }), file({ bytes: body }), storage);

    const view = await getDocumentsForAdmin(app, as(adminId), A, tournamentId);
    const row = view.documents.find((d) => d.id === documentId);
    expect(row).toBeTruthy();
    expect(row?.docType).toBe("要項");
    expect(row?.sizeBytes).toBe(body.length);
    expect(row?.isPublic).toBe(true);
    // 原本は保管用（非公開）に、公開中なので公開用にも置かれる（配信の決まりは C-02 の試験で見る）
    expect(await storage.get("private", row?.storageKey ?? "")).toEqual(body);
    expect(row?.publicKey).toMatch(/^documents\/[0-9a-f]{32}\.pdf$/);
  });

  it("拡張子だけ .pdf にした画像は 400。DB にも保存先にも残らない", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const before = (await getDocumentsForAdmin(app, as(adminId), A, tournamentId)).documents.length;
    expect(await statusOf(() => uploadDocument(app, as(adminId), A, tournamentId, fields(), file({ bytes: png }), storage))).toBe(400);
    const after = await getDocumentsForAdmin(app, as(adminId), A, tournamentId);
    expect(after.documents.length).toBe(before);
  });

  it("10 MB を超えるファイルは 400", async () => {
    const over = new Uint8Array(DOC_MAX_BYTES + 1);
    over.set(pdf(), 0);
    expect(await statusOf(() => uploadDocument(app, as(adminId), A, tournamentId, fields(), file({ bytes: over }), storage))).toBe(400);
  });

  it("代表者はアップロードできない（403）", async () => {
    expect(await statusOf(() => uploadDocument(app, as(repId), A, tournamentId, fields(), file(), storage))).toBe(403);
    expect(await statusOf(() => getDocumentsForAdmin(app, as(repId), A, tournamentId))).toBe(403);
  });

  it("別の協会の管理者からは大会が見えない（404）", async () => {
    expect(await statusOf(() => uploadDocument(app, as(otherAdminId), B, tournamentId, fields(), file(), storage))).toBe(404);
    expect(await statusOf(() => getDocumentsForAdmin(app, as(adminId), A, otherTournamentId))).toBe(404);
  });

  it("別の協会の資料の ID を、この協会の大会の下で指定しても開けない（公開ページも 404）", async () => {
    const mine = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 自分の冊子` }), file(), storage);
    const theirs = await uploadDocument(app, as(otherAdminId), B, otherTournamentId, fields({ title: `${tag} 別協会の冊子` }), file(), storage);
    // URL の協会と資源の協会が違う → 404（§3.1）
    expect(await statusOf(() => editDocument(app, as(adminId), A, tournamentId, theirs.documentId, fields(), storage))).toBe(404);
    expect(await findPublicDocumentUrl(app, A, tournamentId, theirs.documentId, storage)).toBeNull();
    // 大会が違えば、同じ協会の資料でも開けない
    expect(await findPublicDocumentUrl(app, B, otherTournamentId, mine.documentId, storage)).toBeNull();
  });
});

describe("直す・削除する", () => {
  it("種別・タイトル・並び順・公開を変えられる", async () => {
    const { documentId } = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 組み合わせ` }), file(), storage);
    await editDocument(app, as(adminId), A, tournamentId, documentId, {
      docType: "組み合わせ",
      title: `${tag} 組み合わせ表`,
      sortOrder: "10",
      isPublic: "false",
    }, storage);
    const row = (await getDocumentsForAdmin(app, as(adminId), A, tournamentId)).documents.find((d) => d.id === documentId);
    expect(row).toMatchObject({ docType: "組み合わせ", title: `${tag} 組み合わせ表`, sortOrder: 10, isPublic: false });
  });

  it("削除すると一覧から消える。原本は保管用に残る（物理削除まで）", async () => {
    const { documentId } = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 結果` }), file(), storage);
    const before = (await getDocumentsForAdmin(app, as(adminId), A, tournamentId)).documents.find((d) => d.id === documentId);
    await removeDocument(app, as(adminId), A, tournamentId, documentId, storage);
    const after = await getDocumentsForAdmin(app, as(adminId), A, tournamentId);
    expect(after.documents.some((d) => d.id === documentId)).toBe(false);
    expect(await storage.get("private", before?.storageKey ?? "")).not.toBeNull();
    // 削除済みの行には消した人が入る
    const [saved] = await withTenantOn(owner, A, (tx) =>
      tx.select({ deletedBy: tournamentDocuments.deletedBy }).from(tournamentDocuments).where(eq(tournamentDocuments.id, documentId)),
    );
    expect(saved.deletedBy).toBe(adminId);
  });

  it("代表者は直せない・削除できない（403）", async () => {
    const { documentId } = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} その他` }), file(), storage);
    expect(await statusOf(() => editDocument(app, as(repId), A, tournamentId, documentId, fields(), storage))).toBe(403);
    expect(await statusOf(() => removeDocument(app, as(repId), A, tournamentId, documentId, storage))).toBe(403);
  });

  it("ない資料は 404", async () => {
    expect(await statusOf(() => removeDocument(app, as(adminId), A, tournamentId, crypto.randomUUID(), storage))).toBe(404);
    expect(await statusOf(() => removeDocument(app, as(adminId), A, tournamentId, "not-a-uuid", storage))).toBe(404);
  });
});
