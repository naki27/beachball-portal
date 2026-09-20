import { getDb } from "@/db/client";
import { isSameOrigin } from "@/lib/api/csrf";
import { jsonError } from "@/lib/api/errors";
import { clientIp, readJson } from "@/lib/api/request";
import { getPrincipal } from "@/lib/auth/principal";
import { submitContactMessage } from "@/lib/contact";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const body = await readJson(request);
  if (!body) return jsonError(400, "入力してください");

  const principal = await getPrincipal();
  const result = await submitContactMessage(getDb(), {
    type: "association",
    associationId: typeof body.associationId === "string" ? body.associationId : null,
    userId: principal.userId ?? null,
    senderName: typeof body.senderName === "string" ? body.senderName : "",
    senderEmail: typeof body.senderEmail === "string" ? body.senderEmail : "",
    subjectType: typeof body.subjectType === "string" ? body.subjectType : "",
    body: typeof body.body === "string" ? body.body : "",
    ip: clientIp(request),
    honeypot: typeof body.website === "string" ? body.website : "",
    entryId: typeof body.entryId === "string" ? body.entryId : null,
  });

  if (!result.ok) {
    if (result.status === 429) {
      return jsonError(429, result.message, { retryAt: result.retryAt?.toISOString() });
    }
    return jsonError(result.status, result.message);
  }

  return Response.json({ ok: true, messageId: result.messageId }, { status: 201, headers: { "cache-control": "no-store" } });
}
