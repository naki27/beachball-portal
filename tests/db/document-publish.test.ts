import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, deletionLogs, teams, tournamentDocuments, tournaments, users } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { deleteDocument, editDocument, getDocumentsForAdmin, replaceDocumentFile, uploadDocument } from "@/lib/admin/documents";
import { createTournament, deleteTournament, editTournament } from "@/lib/admin/tournaments";
import { purgeFromTrash, restoreFromTrash } from "@/lib/admin/trash";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { PUBLIC_DOCUMENT_PREFIX } from "@/lib/documents/publish";
import { cleanupDocuments } from "@/lib/jobs/document-cleanup";
import { resolvePublicDocumentUrl } from "@/lib/public/documents";
import { getTournamentForPublic } from "@/lib/public/tournaments";
import type { PutOptions, StorageAdapter, StorageBucket } from "@/lib/storage/types";
import { TeamError } from "@/lib/teams/errors";
import { registerTeam } from "@/lib/teams/teams";

// 大会資料の公開と配信（設計書 §5.9「配信の仕組み」・C-02）
// 公開中の資料だけ公開用にあり、非公開・削除・大会を draft に戻すと公開用から消えてアプリの URL が 404。差し替えると名前が変わる
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const job = createDb(requireEnv("JOB_DATABASE_URL"), { max: 1 });

const S = SAWARA_ASSOCIATION_ID;
const random = () => Math.random().toString(36).slice(2, 8);
const tag = `配信${random()}`;
const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

// 中身とヘッダを確かめるための、その場かぎりの保存先
function memoryStorage(): StorageAdapter & { files: Map<string, Uint8Array>; meta: Map<string, PutOptions> } {
  const files = new Map<string, Uint8Array>();
  const meta = new Map<string, PutOptions>();
  const at = (bucket: StorageBucket, key: string) => `${bucket}/${key}`;
  return {
    files,
    meta,
    driver: "local",
    async put(bucket, key, body, options) {
      files.set(at(bucket, key), body);
      meta.set(at(bucket, key), options ?? {});
    },
    async get(bucket, key) {
      return files.get(at(bucket, key)) ?? null;
    },
    async head(bucket, key) {
      const body = files.get(at(bucket, key));
      if (!body) return null;
      const options = meta.get(at(bucket, key)) ?? {};
      return {
        contentType: options.contentType ?? null,
        contentDisposition: options.contentDisposition ?? null,
        cacheControl: options.cacheControl ?? null,
        size: body.byteLength,
      };
    },
    async remove(bucket, key) {
      files.delete(at(bucket, key));
      meta.delete(at(bucket, key));
    },
    async list(bucket, prefix) {
      return [...files.keys()].filter((k) => k.startsWith(`${bucket}/${prefix}`)).map((k) => k.slice(bucket.length + 1));
    },
    publicUrl(key) {
      return `http://localhost:3000/dev-files/${key}`;
    },
  };
}

const pdf = (marker = "A") => new TextEncoder().encode(`%PDF-1.7\n% ${marker} ${"x".repeat(50)}`);
const meta = (over: Record<string, unknown> = {}) => ({ docType: "大会冊子", title: `${tag} 大会冊子`, isPublic: "true", ...over });

const tournamentInput = (status: string) => ({
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
  status,
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

let adminId = "";
let teamAdminId = "";
let tournamentId = "";
const storage = memoryStorage();
const opts = { storage };
const publicKeys = () => [...storage.files.keys()].filter((k) => k.startsWith("public/"));

beforeAll(async () => {
  const [admin] = await owner.insert(users).values({ email: `pub-admin-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  adminId = admin.id;
  const [rep] = await owner.insert(users).values({ email: `pub-rep-${random()}@example.com`, emailVerifiedAt: new Date() }).returning({ id: users.id });
  teamAdminId = rep.id;
  await withTenantOn(owner, S, (tx) => tx.insert(associationAdmins).values({ associationId: S, userId: adminId }));
  await registerTeam(app, S, teamAdminId, { name: `${tag} チーム`, kana: null, contactEmail: null, contactPhone: null, membershipRenewalTarget: false });
  tournamentId = (await createTournament(app, as(adminId), S, tournamentInput("draft"))).id;
});

afterAll(async () => {
  await withTenantOn(owner, S, async (tx) => {
    await tx.delete(tournaments).where(and(eq(tournaments.associationId, S), eq(tournaments.createdBy, adminId)));
    await tx.delete(teams).where(and(eq(teams.associationId, S), eq(teams.createdBy, teamAdminId)));
    await tx.delete(associationAdmins).where(eq(associationAdmins.userId, adminId));
    // 完全に削除した記録（deletion_logs）は実行者を指すので、先に消す
    await tx.delete(deletionLogs).where(and(eq(deletionLogs.associationId, S), eq(deletionLogs.deletedBy, adminId)));
  });
  await owner.delete(users).where(inArray(users.id, [adminId, teamAdminId]));
  await closeDb(owner);
  await closeDb(app);
  await closeDb(job);
});

describe("公開と取り下げ（§5.9）", () => {
  let docId = "";
  let firstKey = "";

  it("大会が準備中の間は、「公開」の資料も公開用に置かれず、アプリの URL は 404", async () => {
    const doc = await uploadDocument(app, as(adminId), S, tournamentId, { contentType: "application/pdf", bytes: pdf() }, meta(), opts);
    docId = doc.id;
    expect(doc.publicKey).toBeNull();
    expect(publicKeys()).toEqual([]);
    expect(await statusOf(() => resolvePublicDocumentUrl(app, S, tournamentId, docId, storage))).toBe(404);
    const view = await getDocumentsForAdmin(app, as(adminId), S, tournamentId);
    expect(view.documents.find((d) => d.id === docId)?.published).toBe(false);
  });

  it("大会を公開（受付中）にすると公開用に置かれ、Content-Type・Content-Disposition・Cache-Control が付く。未ログインで開ける", async () => {
    await editTournament(app, as(adminId), S, tournamentId, tournamentInput("open"), opts);
    const [doc] = (await getDocumentsForAdmin(app, as(adminId), S, tournamentId)).documents.filter((d) => d.id === docId);
    expect(doc.published).toBe(true);
    expect(doc.publicKey).toMatch(new RegExp(`^${PUBLIC_DOCUMENT_PREFIX}[0-9a-f]{32}\\.pdf$`));
    firstKey = doc.publicKey as string;
    expect(storage.files.get(`public/${firstKey}`)).toEqual(pdf());
    const put = storage.meta.get(`public/${firstKey}`);
    expect(put?.contentType).toBe("application/pdf");
    expect(put?.contentDisposition).toBe(`inline; filename*=UTF-8''${encodeURIComponent(`${tag} 大会冊子.pdf`)}`);
    expect(put?.cacheControl).toContain("max-age=3600");
    // アプリの URL（ログイン不要の読み取り）→ 公開用の URL
    expect(await resolvePublicDocumentUrl(app, S, tournamentId, docId, storage)).toBe(`http://localhost:3000/dev-files/${firstKey}`);
    // 大会詳細（公開ページ）の資料の一覧に出る。選手の情報は入らない
    const view = await getTournamentForPublic(app, S, tournamentId);
    expect(view.documents.map((d) => d.id)).toEqual([docId]);
    expect(JSON.stringify(view)).not.toContain("storageKey");
    expect(JSON.stringify(view)).not.toContain(firstKey);
  });

  it("非公開にすると公開用から消え、アプリの URL は 404。公開に戻すと新しい名前", async () => {
    await editDocument(app, as(adminId), S, tournamentId, docId, meta({ isPublic: false }), opts);
    expect(storage.files.has(`public/${firstKey}`)).toBe(false);
    expect(await statusOf(() => resolvePublicDocumentUrl(app, S, tournamentId, docId, storage))).toBe(404);
    expect((await getTournamentForPublic(app, S, tournamentId)).documents).toEqual([]);

    const again = await editDocument(app, as(adminId), S, tournamentId, docId, meta({ isPublic: true }), opts);
    expect(again.publicKey).not.toBeNull();
    expect(again.publicKey).not.toBe(firstKey);
    expect(storage.files.has(`public/${again.publicKey}`)).toBe(true);
    firstKey = again.publicKey as string;
  });

  it("タイトルを変えても公開用の名前（URL）は変わらない", async () => {
    const renamed = await editDocument(app, as(adminId), S, tournamentId, docId, meta({ title: `${tag} 冊子（改）` }), opts);
    expect(renamed.publicKey).toBe(firstKey);
  });

  it("差し替えると保管用は上書き、公開用は新しい名前になり、古い名前は消える", async () => {
    const replaced = await replaceDocumentFile(app, as(adminId), S, tournamentId, docId, { contentType: "application/pdf", bytes: pdf("B") }, opts);
    expect(replaced.publicKey).not.toBe(firstKey);
    expect(replaced.sizeBytes).toBe(pdf("B").byteLength);
    expect(storage.files.has(`public/${firstKey}`)).toBe(false);
    expect(storage.files.get(`public/${replaced.publicKey}`)).toEqual(pdf("B"));
    expect(storage.files.get(`private/${replaced.storageKey}`)).toEqual(pdf("B"));
    expect(await resolvePublicDocumentUrl(app, S, tournamentId, docId, storage)).toContain(replaced.publicKey);
    firstKey = replaced.publicKey as string;
    // 差し替えも PDF の検査を通す
    expect(
      await statusOf(() => replaceDocumentFile(app, as(adminId), S, tournamentId, docId, { contentType: "application/pdf", bytes: new Uint8Array(20) }, opts)),
    ).toBe(400);
    expect(await statusOf(() => replaceDocumentFile(app, as(teamAdminId), S, tournamentId, docId, { contentType: "application/pdf", bytes: pdf() }, opts))).toBe(403);
  });

  it("大会を準備中に戻すと公開用から消え、公開に戻すと置き直される", async () => {
    await editTournament(app, as(adminId), S, tournamentId, tournamentInput("draft"), opts);
    expect(publicKeys()).toEqual([]);
    expect(await statusOf(() => resolvePublicDocumentUrl(app, S, tournamentId, docId, storage))).toBe(404);
    await editTournament(app, as(adminId), S, tournamentId, tournamentInput("closed"), opts);
    expect(publicKeys().length).toBe(1);
    expect(await statusOf(() => resolvePublicDocumentUrl(app, S, tournamentId, docId, storage))).toBe("ok");
  });

  it("削除すると公開用から消え 404。削除済みデータから戻すと公開用に置き直される", async () => {
    expect(await statusOf(() => deleteDocument(app, as(teamAdminId), S, tournamentId, docId, opts))).toBe(403);
    await deleteDocument(app, as(adminId), S, tournamentId, docId, opts);
    expect(publicKeys()).toEqual([]);
    expect(await statusOf(() => resolvePublicDocumentUrl(app, S, tournamentId, docId, storage))).toBe(404);
    expect((await getDocumentsForAdmin(app, as(adminId), S, tournamentId)).documents.map((d) => d.id)).not.toContain(docId);

    await restoreFromTrash(app, as(adminId), S, "tournament_documents", docId, opts);
    expect(publicKeys().length).toBe(1);
    expect(await statusOf(() => resolvePublicDocumentUrl(app, S, tournamentId, docId, storage))).toBe("ok");
  });

  it("大会を削除すると公開用から消え、復元すると置き直される", async () => {
    await deleteTournament(app, as(adminId), S, tournamentId, opts);
    expect(publicKeys()).toEqual([]);
    expect(await statusOf(() => resolvePublicDocumentUrl(app, S, tournamentId, docId, storage))).toBe(404);
    // 大会が削除済みの間は資料だけの復元はできない
    await restoreFromTrash(app, as(adminId), S, "tournaments", tournamentId, opts);
    expect(publicKeys().length).toBe(1);
    expect(await statusOf(() => resolvePublicDocumentUrl(app, S, tournamentId, docId, storage))).toBe("ok");
  });

  it("完全に削除すると保管用・公開用のファイルも消える", async () => {
    const [doc] = (await getDocumentsForAdmin(app, as(adminId), S, tournamentId)).documents.filter((d) => d.id === docId);
    await deleteDocument(app, as(adminId), S, tournamentId, docId, opts);
    await purgeFromTrash(app, as(adminId), S, "tournament_documents", docId, "テスト", "other", new Date(), opts);
    expect(storage.files.has(`private/${doc.storageKey}`)).toBe(false);
    expect(publicKeys()).toEqual([]);
    const rows = await withTenantOn(owner, S, (tx) => tx.select({ id: tournamentDocuments.id }).from(tournamentDocuments).where(eq(tournamentDocuments.id, docId)));
    expect(rows).toEqual([]);
  });

  it("大会を完全に削除すると、資料のファイルも一緒に消える", async () => {
    const doc = await uploadDocument(app, as(adminId), S, tournamentId, { contentType: "application/pdf", bytes: pdf("C") }, meta({ title: `${tag} 要項` }), opts);
    expect(doc.publicKey).not.toBeNull();
    await deleteTournament(app, as(adminId), S, tournamentId, opts);
    const result = await purgeFromTrash(app, as(adminId), S, "tournaments", tournamentId, "テスト", "other", new Date(), opts);
    expect(result.cascadedCount).toBeGreaterThanOrEqual(1);
    expect(storage.files.has(`private/${doc.storageKey}`)).toBe(false);
    expect(publicKeys()).toEqual([]);
  });
});

describe("日次ジョブの後始末（⑥・§5.9）", () => {
  it("行のない保管用・どの行からも指されていない公開用のファイルを消し、公開の食い違いを直す", async () => {
    const cleanup = memoryStorage();
    const id = (await createTournament(app, as(adminId), S, tournamentInput("open"))).id;
    const doc = await uploadDocument(app, as(adminId), S, id, { contentType: "application/pdf", bytes: pdf("D") }, meta({ title: `${tag} 後始末` }), { storage: cleanup });
    expect(doc.publicKey).not.toBeNull();

    // 消し忘れ: 行のない保管用と、行から指されていない公開用
    await cleanup.put("private", `documents/${S}/${id}/00000000-0000-4000-8000-000000000000.pdf`, pdf("orphan"));
    await cleanup.put("public", `${PUBLIC_DOCUMENT_PREFIX}${"f".repeat(32)}.pdf`, pdf("orphan"));
    // 食い違い: 公開すべきなのに公開用がない（行の名前だけ消しておく）
    await withTenantOn(owner, S, (tx) => tx.update(tournamentDocuments).set({ publicKey: null }).where(eq(tournamentDocuments.id, doc.id)));
    await cleanup.remove("public", doc.publicKey as string);

    const result = await cleanupDocuments(job, cleanup);
    expect(result.removedPrivate).toBe(1);
    expect(result.removedPublic).toBe(1);
    expect(result.published).toBeGreaterThanOrEqual(1);
    const [fixed] = (await getDocumentsForAdmin(app, as(adminId), S, id)).documents.filter((d) => d.id === doc.id);
    expect(fixed.publicKey).not.toBeNull();
    expect(cleanup.files.has(`public/${fixed.publicKey}`)).toBe(true);
    expect(cleanup.files.has(`private/${doc.storageKey}`)).toBe(true);
    expect([...cleanup.files.keys()].filter((k) => k.includes("orphan") || k.includes("f".repeat(32)))).toEqual([]);
  });
});
