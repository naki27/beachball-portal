import { getDb } from "@/db/client";
import { associations } from "@/db/schema";
import { platformErrorResponse, requirePlatformAdmin } from "@/lib/api/platform";
import { readJson } from "@/lib/api/request";
import { createAssociationTenant } from "@/lib/platform/associations";
import { listAssociationStats } from "@/lib/repo/platform";

// GET /api/platform/associations — 全テナントの一覧と件数（設計書 §10）
export async function GET(request: Request): Promise<Response> {
  const gate = await requirePlatformAdmin(request);
  if (gate instanceof Response) return gate;
  const db = getDb();
  const rows = await db.select().from(associations).orderBy(associations.createdAt);
  const stats = new Map((await listAssociationStats(db, gate.principal.userId)).map((s) => [s.associationId, s]));
  return Response.json(
    {
      associations: rows.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        status: a.status,
        fiscalYearStartMonth: a.fiscalYearStartMonth,
        stats: stats.get(a.id) ?? null,
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

// POST /api/platform/associations — テナントの作成（§5.14「テナントの作成」）
export async function POST(request: Request): Promise<Response> {
  const gate = await requirePlatformAdmin(request);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  const adminEmails = Array.isArray(body?.adminEmails) ? body.adminEmails.filter((e): e is string => typeof e === "string") : [];
  try {
    const result = await createAssociationTenant(getDb(), gate.principal.userId, {
      name: typeof body?.name === "string" ? body.name : "",
      slug: typeof body?.slug === "string" ? body.slug : "",
      fiscalYearStartMonth: typeof body?.fiscalYearStartMonth === "number" ? body.fiscalYearStartMonth : undefined,
      contactEmail: typeof body?.contactEmail === "string" ? body.contactEmail : null,
      adminEmails,
    });
    return Response.json(
      { ok: true, association: { id: result.association.id, slug: result.association.slug, name: result.association.name } },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return platformErrorResponse(error);
  }
}
