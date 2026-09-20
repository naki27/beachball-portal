import { getDb } from "@/db/client";
import { editPreset, removePreset } from "@/lib/admin/category-presets";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; presetId: string }> };

// PATCH — 「よく使う部」の編集（記号は不変・§5.4）。テナント管理者だけ
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, presetId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (!body) return jsonError(400, "部の名前を入力してください", { field: "labelDefault" });
  try {
    await editPreset(getDb(), gate.principal, gate.association.id, presetId, body);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

// DELETE — 「よく使う部」の削除（論理削除）。大会で使われていれば 409
export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, presetId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    await removePreset(getDb(), gate.principal, gate.association.id, presetId);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
