import { getDb } from "@/db/client";
import { setIndividualRegistration } from "@/lib/admin/association-settings";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string }> };

// PATCH /api/[slug]/admin/association — 協会の設定（K-02）。いまは individualRegistrationEnabled だけ。テナント管理者だけ
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = await readJson(request);
  if (typeof body?.individualRegistrationEnabled !== "boolean") {
    return jsonError(400, "設定の値が正しくありません", { field: "individualRegistrationEnabled" });
  }
  try {
    await setIndividualRegistration(getDb(), gate.principal, gate.association.id, body.individualRegistrationEnabled);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
