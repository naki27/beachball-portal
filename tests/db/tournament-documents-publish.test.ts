import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationAdmins, associations, deletionLogs, tournaments, users } from "@/db/schema";
import { withTenantOn } from "@/db/tenant";
import { editDocument, removeDocument, replaceDocumentFile, uploadDocument } from "@/lib/admin/documents";
import { createTournament, deleteTournament, editTournament } from "@/lib/admin/tournaments";
import { purgeFromTrash, restoreFromTrash } from "@/lib/admin/trash";
import { ANONYMOUS, type Principal } from "@/lib/authz";
import { cleanUpDocumentFiles } from "@/lib/jobs/document-cleanup";
import { findPublicDocumentUrl, listDocumentsForPublic } from "@/lib/public/tournaments";
import { createLocalStorage } from "@/lib/storage/local";

// 大会資料の公開と配信（設計書 §5.9「配信の仕組み」・C-02）
// 非公開・削除・大会を draft に戻すと公開用から消え、アプリの URL が開けなくなる。差し替えると URL が変わる
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const app = createDb(requireEnv("DATABASE_URL"), { max: 1 });

const root = mkdtempSync(join(tmpdir(), "bbp-pub-"));
const storage = createLocalStorage(root, "http://localhost:3000/dev-files");

const random = () => Math.random().toString(36).slice(2, 8);
const tag = `公開${random()}`;

const as = (userId: string): Principal & { userId: string } => ({ ...ANONYMOUS, userId, sessionState: "active" });

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);
const file = (extra = random()) => ({ name: "資料.pdf", contentType: "application/pdf", bytes: pdf(extra) });
const fields = (over: Record<string, unknown> = {}) => ({ docType: "大会冊子", title: `${tag} 冊子`, sortOrder: "100", isPublic: "true", ...over });

let A = "";
let adminId = "";
let tournamentId = "";

const tournamentInput = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

beforeAll(async () => {
  const [user] = await owner
    .insert(users)
    .values({ email: `pub-admin-${random()}@example.com`, emailVerifiedAt: new Date() })
    .returning({ id: users.id });
  adminId = user.id;
  const [association] = await owner
    .insert(associations)
    .values({ name: `${tag} 協会`, slug: `pub-${random()}` })
    .returning({ id: associations.id });
  A = association.id;
  await withTenantOn(owner, A, (tx) => tx.insert(associationAdmins).values({ associationId: A, userId: adminId }));
  tournamentId = (await createTournament(app, as(adminId), A, tournamentInput())).id;
});

afterAll(async () => {
  await withTenantOn(owner, A, async (tx) => {
    await tx.delete(tournaments).where(eq(tournaments.associationId, A));
    await tx.delete(associationAdmins).where(eq(associationAdmins.associationId, A));
    await tx.delete(deletionLogs).where(eq(deletionLogs.associationId, A));
  });
  await owner.delete(associations).where(inArray(associations.id, [A]));
  await owner.delete(users).where(inArray(users.id, [adminId]));
  await closeDb(owner);
  await closeDb(app);
  rmSync(root, { recursive: true, force: true });
});

async function publicUrlOf(documentId: string, tournament = tournamentId): Promise<string | null> {
  return findPublicDocumentUrl(app, A, tournament, documentId, storage);
}

describe("公開すると公開用に置かれる", () => {
  it("公開中の資料だけが公開ページに出て、アプリの URL から公開用の URL へ送られる", async () => {
    const body = pdf("冊子の中身");
    const open = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 公開の冊子` }), { ...file(), bytes: body }, storage);
    const hidden = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 非公開の冊子`, isPublic: "false" }), file(), storage);
    expect(open.published).toBe(true);
    expect(hidden.published).toBe(false);

    const documents = await listDocumentsForPublic(app, A, tournamentId);
    expect(documents.map((d) => d.id)).toContain(open.documentId);
    expect(documents.map((d) => d.id)).not.toContain(hidden.documentId);

    const url = await publicUrlOf(open.documentId);
    expect(url).toMatch(/^http:\/\/localhost:3000\/dev-files\/documents\/[0-9a-f]{32}\.pdf$/);
    // 公開用にも同じ中身が置かれている
    const key = url?.replace("http://localhost:3000/dev-files/", "") ?? "";
    expect(await storage.get("public", key)).toEqual(body);
    expect(await publicUrlOf(hidden.documentId)).toBeNull();
  });

  it("非公開にすると公開用から消え、アプリの URL も開けなくなる", async () => {
    const { documentId } = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 要項` }), file(), storage);
    const url = await publicUrlOf(documentId);
    const key = url?.replace("http://localhost:3000/dev-files/", "") ?? "";
    expect(await storage.get("public", key)).not.toBeNull();

    await editDocument(app, as(adminId), A, tournamentId, documentId, fields({ title: `${tag} 要項`, isPublic: "false" }), storage);
    expect(await publicUrlOf(documentId)).toBeNull();
    expect(await storage.get("public", key)).toBeNull();

    // 公開し直すと**新しい名前**になる（前に配った URL は開けたままにしない）
    await editDocument(app, as(adminId), A, tournamentId, documentId, fields({ title: `${tag} 要項`, isPublic: "true" }), storage);
    const again = await publicUrlOf(documentId);
    expect(again).not.toBeNull();
    expect(again).not.toBe(url);
  });

  it("削除すると公開用から消え、アプリの URL も開けなくなる", async () => {
    const { documentId } = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 結果` }), file(), storage);
    const key = (await publicUrlOf(documentId))?.replace("http://localhost:3000/dev-files/", "") ?? "";
    await removeDocument(app, as(adminId), A, tournamentId, documentId, storage);
    expect(await publicUrlOf(documentId)).toBeNull();
    expect(await storage.get("public", key)).toBeNull();
  });

  it("ファイルを差し替えると公開用の URL が変わり、古いファイルは消える", async () => {
    const { documentId } = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 組み合わせ` }), file("1 回戦"), storage);
    const before = await publicUrlOf(documentId);
    const beforeKey = before?.replace("http://localhost:3000/dev-files/", "") ?? "";

    const newBody = pdf("2 回戦まで");
    await replaceDocumentFile(app, as(adminId), A, tournamentId, documentId, { ...file(), bytes: newBody }, storage);
    const after = await publicUrlOf(documentId);
    expect(after).not.toBe(before);
    expect(await storage.get("public", beforeKey)).toBeNull();
    const afterKey = after?.replace("http://localhost:3000/dev-files/", "") ?? "";
    expect(await storage.get("public", afterKey)).toEqual(newBody);

    const listed = await listDocumentsForPublic(app, A, tournamentId);
    expect(listed.find((d) => d.id === documentId)?.sizeBytes).toBe(newBody.length);
  });
});

describe("大会の状態と削除", () => {
  it("大会を draft に戻すと公開用から消え、open に戻すとまた置かれる", async () => {
    const id = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 状態の大会` }))).id;
    const { documentId } = await uploadDocument(app, as(adminId), A, id, fields({ title: `${tag} 状態の冊子` }), file(), storage);
    const key = (await publicUrlOf(documentId, id))?.replace("http://localhost:3000/dev-files/", "") ?? "";
    expect(key).not.toBe("");

    await editTournament(app, as(adminId), A, id, tournamentInput({ name: `${tag} 状態の大会`, status: "draft" }), storage);
    expect(await publicUrlOf(documentId, id)).toBeNull();
    expect(await storage.get("public", key)).toBeNull();
    // draft の大会は公開ページ自体が 404
    await expect(listDocumentsForPublic(app, A, id)).rejects.toThrow();

    await editTournament(app, as(adminId), A, id, tournamentInput({ name: `${tag} 状態の大会`, status: "open" }), storage);
    const again = await publicUrlOf(documentId, id);
    expect(again).not.toBeNull();
    expect(again).not.toBe(`http://localhost:3000/dev-files/${key}`);
  });

  it("大会を削除すると公開用から消え、復元すると戻る", async () => {
    const id = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 消す大会` }))).id;
    const { documentId } = await uploadDocument(app, as(adminId), A, id, fields({ title: `${tag} 消す冊子` }), file(), storage);
    const key = (await publicUrlOf(documentId, id))?.replace("http://localhost:3000/dev-files/", "") ?? "";

    await deleteTournament(app, as(adminId), A, id, storage);
    expect(await publicUrlOf(documentId, id)).toBeNull();
    expect(await storage.get("public", key)).toBeNull();

    await restoreFromTrash(app, as(adminId), A, "tournaments", id, storage);
    expect(await publicUrlOf(documentId, id)).not.toBeNull();
  });
});

describe("迷子のファイルの後始末（日次ジョブ ⑥）", () => {
  it("大会を完全に削除したあと、公開用・保管用のファイルが消える", async () => {
    const id = (await createTournament(app, as(adminId), A, tournamentInput({ name: `${tag} 完全削除の大会` }))).id;
    const { documentId } = await uploadDocument(app, as(adminId), A, id, fields({ title: `${tag} 完全削除の冊子` }), file(), storage);
    const publicKey = (await publicUrlOf(documentId, id))?.replace("http://localhost:3000/dev-files/", "") ?? "";
    const privateKey = `documents/${A}/${id}/${documentId}.pdf`;
    expect(await storage.get("private", privateKey)).not.toBeNull();

    await deleteTournament(app, as(adminId), A, id, storage);
    await purgeFromTrash(app, as(adminId), A, "tournaments", id, "試験のため");
    // 論理削除のあいだは原本を残す。行が消えてから後始末で消える
    expect(await storage.get("private", privateKey)).not.toBeNull();

    const result = await cleanUpDocumentFiles(app, storage);
    expect(result.privateRemoved).toBeGreaterThanOrEqual(1);
    expect(await storage.get("private", privateKey)).toBeNull();
    expect(await storage.get("public", publicKey)).toBeNull();
  });

  it("使われているファイルは消さない", async () => {
    const { documentId } = await uploadDocument(app, as(adminId), A, tournamentId, fields({ title: `${tag} 残る冊子` }), file(), storage);
    const publicKey = (await publicUrlOf(documentId))?.replace("http://localhost:3000/dev-files/", "") ?? "";
    await cleanUpDocumentFiles(app, storage);
    expect(await storage.get("public", publicKey)).not.toBeNull();
    expect(await publicUrlOf(documentId)).not.toBeNull();
  });
});
