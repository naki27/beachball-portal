import { getDb } from "@/db/client";
import { createPreset } from "@/lib/admin/category-presets";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string }> };

// POST /api/[slug]/admin/category-presets — 「よく使う部門」を足す（設計書 §5.4）。テナント管理者だけ
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "部の名前を入力してください", { field: "labelDefault" });
  try {
    const preset = await createPreset(getDb(), gate.principal, gate.association.id, body);
    return Response.json({ ok: true, preset: { id: preset.id } }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
