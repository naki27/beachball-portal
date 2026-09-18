import { getDb } from "@/db/client";
import { platformErrorResponse, requirePlatformAdmin } from "@/lib/api/platform";
import { readJson } from "@/lib/api/request";
import { updateAssociation } from "@/lib/platform/associations";

type Props = { params: Promise<{ id: string }> };

// PATCH /api/platform/associations/:id — 協会名・スラッグ・連絡先の変更（旧スラッグは履歴へ・§5.14）
export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const gate = await requirePlatformAdmin(request);
  if (gate instanceof Response) return gate;
  const { id } = await params;
  const body = await readJson(request);
  try {
    const updated = await updateAssociation(getDb(), gate.principal.userId, id, {
      name: typeof body?.name === "string" ? body.name : undefined,
      slug: typeof body?.slug === "string" ? body.slug : undefined,
      contactEmail: typeof body?.contactEmail === "string" ? body.contactEmail : undefined,
    });
    return Response.json(
      { ok: true, association: { id: updated.id, slug: updated.slug, name: updated.name, contactEmail: updated.contactEmail } },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return platformErrorResponse(error);
  }
}
