import { getDb } from "@/db/client";
import { isSameOrigin } from "@/lib/api/csrf";
import { jsonError } from "@/lib/api/errors";
import { readJson } from "@/lib/api/request";
import { getPrincipal } from "@/lib/auth/principal";
import { isPlatformAdmin } from "@/lib/authz";
import { setPlatformContactStatus, type ContactStatus } from "@/lib/contact-admin";

export async function PATCH(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const principal = await getPrincipal();
  if (!isPlatformAdmin(principal)) return jsonError(403, "運営管理者だけが問い合わせを管理できます");
  const body = await readJson(request);
  const id = typeof body?.id === "string" ? body.id : "";
  const status = body?.status;
  if (!id || (status !== "new" && status !== "done")) return jsonError(400, "問い合わせの状態を指定してください");
  const updated = await setPlatformContactStatus(getDb(), id, status as ContactStatus);
  if (!updated) return jsonError(404, "問い合わせが見つかりません");
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
