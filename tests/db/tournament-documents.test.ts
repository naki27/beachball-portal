import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, teams, tournamentDocuments, tournaments, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { documentStorageKey, editDocument, getDocumentsForAdmin, uploadDocument } from "@/lib/admin/documents";
import { createTournament } from "@/lib/admin/tournaments";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/document-input";
import type { StorageAdapter, StorageBucket } from "@/lib/storage/types";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 大会資料のアップロードと保管（設計書 §5.9・C-01）。準備は app_owner、検査はアプリと同じ app_user（DATABASE_URL）で行う
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `資料${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

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
    publicUrl(key) {
      return `http://localhost:3000/dev-files/${key}`;
    },
  };
}

const pdf = (size = 200) => {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  return bytes;
};
const png = () => {
  const bytes = new Uint8Array(200);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
};
const meta = (over: Record<string, unknown> = {}) => ({ docType: "大会冊子", title: `${tag} 大会冊子`, isPublic: "true", ...over });

async function statusOf(run: () => Promise<unknown>): Promise<"ok" | number> {
  try {
    await run();
    return "ok";
  } catch (error) {
    if (error instanceof TeamError) return error.status;
    throw error;
  }
}

let adminId = "";
let teamAdminId = "";
let otherAssociationId = "";
let otherAdminId = "";
let tournamentId = "";

beforeAll(async () => {
  const [admin] = await owner.insert(users).values({ email: `doc-admin-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  adminId = admin.id;
  const [rep] = await owner.insert(users).values({ email: `doc-rep-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  teamAdminId = rep.id;
  const [other] = await owner.insert(associations).values({ name: `${tag} 別協会`, slug: `doc-${random()}` }).returning({ id: associations.id });
  otherAssociationId = other.id;
  const [otherAdmin] = await owner.insert(users).values({ email: `doc-other-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  otherAdminId = otherAdmin.id;

  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: adminId }));
  await withTenantOn(owner, otherAssociationId, (tx) =>
    tx.insert(associationAdmins).values({ associationId: otherAssociationId, userId: otherAdminId }),
  );
  await registerTeam(app, S, teamAdminId, { name: `${tag} チーム`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false });

  const tournament = await createTournament(app, as(adminId), S, {
    name: `${tag} 春季大会`,
    eventDate: "2027-03-28",
    ageReferenceDate: "",
    venue: "",
    description: "",
    entryStartDate: "2027-01-10",
    entryEndDate: "2027-02-28",
    teamSizeMin: "4",
    teamSizeMax: "7",
    maxEntries: "",
    status: "draft",
  });
  tournamentId = tournament.id;
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    // 大会を消すと資料の行も cascade で消える
    await tx.delete(tournaments).where(and(eq(tournaments.associationId, S), eq(tournaments.createdBy, adminId)));
    await tx.delete(teams).where(and(eq(teams.associationId, S), eq(teams.createdBy, teamAdminId)));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, adminId));
  });
  await withTenantOn(owner, otherAssociationId, (tx) => tx.delete(associationAdmins).where(eq(associationAdmins.associationId, otherAssociationId)));
  await owner.delete(associations).where(eq(associations.id, otherAssociationId));
  await owner.delete(users).where(inArray(users.id, [adminId, teamAdminId, otherAdminId]));
  await closeDb(owner);
  await closeDb(app);
});

describe("アップロード（テナント管理者だけ・§3.2 manageTournaments）", () => {
  it("PDF を保管用（非公開）のバケットに置き、行を作る。並び順は末尾", async () => {
    const storage = memoryStorage();
    const first = await uploadDocument(app, as(adminId), S, tournamentId, { contentType: "application/pdf", bytes: pdf(300) }, meta(), { storage });
    expect(first.docType).toBe("大会冊子");
    expect(first.title).toBe(`${tag} 大会冊子`);
    expect(first.isPublic).toBe(true);
    expect(first.sizeBytes).toBe(300);
    expect(first.publicKey).toBeNull(); // 公開用へのコピーは C-02
    expect(first.storageKey).toBe(documentStorageKey(S, tournamentId, first.id));
    expect(storage.files.get(`private/${first.storageKey}`)?.byteLength).toBe(300);
    expect(storage.files.has(`public/${first.storageKey}`)).toBe(false);

    const second = await uploadDocument(
      app,
      as(adminId),
      S,
      tournamentId,
      { contentType: "application/pdf", bytes: pdf() },
      meta({ docType: "要項", title: `${tag} 要項`, isPublic: "false" }),
      { storage },
    );
    expect(second.sortOrder).toBe(first.sortOrder + 1);
    expect(second.isPublic).toBe(false);

    const view = await getDocumentsForAdmin(app, as(adminId), S, tournamentId);
    expect(view.documents.map((d) => d.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(view.documents.findIndex((d) => d.id === first.id)).toBeLessThan(view.documents.findIndex((d) => d.id === second.id));
  });

  it("拡張子だけ .pdf の画像・Content-Type が違うもの・10 MB 超は 400。ファイルも行も残らない", async () => {
    const storage = memoryStorage();
    const before = (await getDocumentsForAdmin(app, as(adminId), S, tournamentId)).documents.length;
    const attempts: Array<[string, Uint8Array]> = [
      ["application/pdf", png()],
      ["image/png", pdf()],
      ["application/pdf", pdf(MAX_DOCUMENT_BYTES + 1)],
      ["application/pdf", new Uint8Array(0)],
    ];
    for (const [contentType, bytes] of attempts) {
      expect(await statusOf(() => uploadDocument(app, as(adminId), S, tournamentId, { contentType, bytes }, meta(), { storage }))).toBe(400);
    }
    expect(storage.files.size).toBe(0);
    expect((await getDocumentsForAdmin(app, as(adminId), S, tournamentId)).documents.length).toBe(before);
  });

  it("種別・タイトルの誤りは 400（欄名つき）", async () => {
    const storage = memoryStorage();
    await expect(
      uploadDocument(app, as(adminId), S, tournamentId, { contentType: "application/pdf", bytes: pdf() }, meta({ docType: "booklet" }), { storage }),
    ).rejects.toMatchObject({ status: 400, extra: { field: "docType" } });
    await expect(
      uploadDocument(app, as(adminId), S, tournamentId, { contentType: "application/pdf", bytes: pdf() }, meta({ title: "" }), { storage }),
    ).rejects.toMatchObject({ status: 400, extra: { field: "title" } });
    expect(storage.files.size).toBe(0);
  });

  it("代表者は 403、別の協会の管理者は 403、別の協会から見た大会は 404", async () => {
    const storage = memoryStorage();
    const upload = (actor: string, associationId: string) =>
      uploadDocument(app, as(actor), associationId, tournamentId, { contentType: "application/pdf", bytes: pdf() }, meta(), { storage });
    expect(await statusOf(() => upload(teamAdminId, S))).toBe(403);
    expect(await statusOf(() => upload(otherAdminId, S))).toBe(403);
    expect(await statusOf(() => upload(otherAdminId, otherAssociationId))).toBe(404);
    expect(await statusOf(() => getDocumentsForAdmin(app, as(teamAdminId), S, tournamentId))).toBe(403);
    expect(await statusOf(() => getDocumentsForAdmin(app, as(otherAdminId), otherAssociationId, tournamentId))).toBe(404);
    expect(storage.files.size).toBe(0);
  });

  it("ファイルを置けなければ行も残らない（1 トランザクション）", async () => {
    const storage = memoryStorage();
    storage.put = async () => {
      throw new Error("保存先に置けません");
    };
    await expect(
      uploadDocument(app, as(adminId), S, tournamentId, { contentType: "application/pdf", bytes: pdf() }, meta({ title: `${tag} 置けない` }), { storage }),
    ).rejects.toThrow("保存先に置けません");
    const rows = await withTenantOn(owner, S, (tx) =>
      tx.select({ id: tournamentDocuments.id }).from(tournamentDocuments).where(eq(tournamentDocuments.title, `${tag} 置けない`)),
    );
    expect(rows).toEqual([]);
  });
});

describe("編集（種別・タイトル・公開／非公開・並び順）", () => {
  it("管理者は変えられる。並び順を省くとそのまま", async () => {
    const storage = memoryStorage();
    const doc = await uploadDocument(
      app,
      as(adminId),
      S,
      tournamentId,
      { contentType: "application/pdf", bytes: pdf() },
      meta({ docType: "組み合わせ", title: `${tag} 組み合わせ`, sortOrder: "7" }),
      { storage },
    );
    expect(doc.sortOrder).toBe(7);
    const edited = await editDocument(app, as(adminId), S, tournamentId, doc.id, { docType: "結果", title: `${tag} 結果`, isPublic: false });
    expect(edited).toMatchObject({ id: doc.id, docType: "結果", title: `${tag} 結果`, isPublic: false, sortOrder: 7 });
    const moved = await editDocument(app, as(adminId), S, tournamentId, doc.id, { docType: "結果", title: `${tag} 結果`, isPublic: true, sortOrder: 1 });
    expect(moved.sortOrder).toBe(1);
    // 保管用のファイルはそのまま
    expect(storage.files.has(`private/${doc.storageKey}`)).toBe(true);
  });

  it("代表者は 403、ない資料・別の大会の資料は 404", async () => {
    const storage = memoryStorage();
    const doc = await uploadDocument(app, as(adminId), S, tournamentId, { contentType: "application/pdf", bytes: pdf() }, meta(), { storage });
    const body = { docType: "その他", title: "x", isPublic: true };
    expect(await statusOf(() => editDocument(app, as(teamAdminId), S, tournamentId, doc.id, body))).toBe(403);
    expect(await statusOf(() => editDocument(app, as(adminId), S, tournamentId, "00000000-0000-4000-8000-000000000000", body))).toBe(404);
    expect(await statusOf(() => editDocument(app, as(adminId), S, "00000000-0000-4000-8000-000000000000", doc.id, body))).toBe(404);
    expect(await statusOf(() => editDocument(app, as(adminId), S, tournamentId, "not-a-uuid", body))).toBe(404);
  });
});
