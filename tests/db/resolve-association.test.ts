import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createDb } from "@/db/client";
import { requireEnv } from "@/db/env";
import { associationSlugHistory } from "@/db/schema";
import { SAWARA_ASSOCIATION_ID, SAWARA_SLUG } from "@/db/seed";
import { withTenantOn } from "@/db/tenant";
import { resolveAssociationForApi } from "@/lib/api/resolve";
import { resolveAssociation } from "@/lib/resolve-association";

// URL のスラッグから協会を決める（§5.14 の解決順）。resolveAssociation はアプリ用の接続（app_user）で読む
// 旧スラッグの行は app_owner で入れ、最後に消す
const owner = createDb(requireEnv("MIGRATION_DATABASE_URL"), { max: 1 });
const OLD_SLUG = `sawara-old-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.insert(associationSlugHistory).values({ slug: OLD_SLUG, associationId: SAWARA_ASSOCIATION_ID });
  });
});

afterAll(async () => {
  await withTenantOn(owner, SAWARA_ASSOCIATION_ID, async (tx) => {
    await tx.delete(associationSlugHistory).where(eq(associationSlugHistory.slug, OLD_SLUG));
  });
  await closeDb(owner);
  await closeDb();
});

describe("resolveAssociation", () => {
  it("現行のスラッグ → その協会", async () => {
    const r = await resolveAssociation(SAWARA_SLUG);
    expect(r.kind).toBe("found");
    if (r.kind === "found") expect(r.association.id).toBe(SAWARA_ASSOCIATION_ID);
  });

  it("旧スラッグ → 新しいスラッグへ転送（RLS の下でも SECURITY DEFINER 関数で読める）", async () => {
    const r = await resolveAssociation(OLD_SLUG);
    expect(r).toMatchObject({ kind: "redirect", currentSlug: SAWARA_SLUG });
  });

  it("予約語・形が違う・ないスラッグ → 404", async () => {
    expect(await resolveAssociation("admin")).toEqual({ kind: "not_found" });
    expect(await resolveAssociation("SAWARA")).toEqual({ kind: "not_found" });
    expect(await resolveAssociation("nothing-here")).toEqual({ kind: "not_found" });
  });
});

describe("resolveAssociationForApi（/api/[slug]/…）", () => {
  it("旧スラッグは 308。パスの残りと検索文字列を保つ", async () => {
    const result = await resolveAssociationForApi(
      OLD_SLUG,
      new Request(`http://localhost:3000/api/${OLD_SLUG}/teams?q=1`),
    );
    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`http://localhost:3000/api/${SAWARA_SLUG}/teams?q=1`);
  });

  it("ないスラッグは 404 の JSON", async () => {
    const result = (await resolveAssociationForApi("nothing-here", new Request("http://localhost:3000/api/nothing-here/teams"))) as Response;
    expect(result.status).toBe(404);
    expect(await result.json()).toMatchObject({ error: { status: 404 } });
  });

  it("現行のスラッグは協会を返す", async () => {
    const result = await resolveAssociationForApi(SAWARA_SLUG, new Request("http://localhost:3000/api/sawara/teams"));
    expect(result).not.toBeInstanceOf(Response);
    if (!(result instanceof Response)) expect(result.association.slug).toBe(SAWARA_SLUG);
  });
});
