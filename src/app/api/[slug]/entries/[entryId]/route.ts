import { getDb } from "@/db/client";
import { readJson } from "@/lib/api/request";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";
import { getEntryDetail } from "@/lib/entries/entry-detail";
import { cancelEntry, updateEntry } from "@/lib/entries/update-entry";

type Props = { params: Promise<{ slug: string; entryId: string }> };

// /api/[slug]/entries/[entryId] — 申込の参照・変更・取消（設計書 §5.5(d)・§10）
// 締切後の代表者の PATCH / DELETE は 409（テナント管理者は可）。代表者でない人は 403（画面を隠すだけにしない）

export async function GET(request: Request, { params }: Props): Promise<Response> {
  const { slug, entryId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    const entry = await getEntryDetail(getDb(), gate.principal, gate.association.id, entryId);
    return Response.json({ ok: true, entry }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: Props): Promise<Response> {
  const { slug, entryId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  const body = (await readJson(request)) ?? {};
  try {
    const result = await updateEntry(getDb(), gate.principal, gate.association.id, entryId, body);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Props): Promise<Response> {
  const { slug, entryId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;
  try {
    const result = await cancelEntry(getDb(), gate.principal, gate.association.id, entryId);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
