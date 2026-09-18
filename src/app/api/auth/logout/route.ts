import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { jsonError } from "@/lib/api/errors";
import { isSameOrigin } from "@/lib/api/csrf";
import { readCookie } from "@/lib/api/request";
import { cookieAttributes, sessionCookieName } from "@/lib/auth/cookies";
import { deleteSession } from "@/lib/auth/session";

// POST /api/auth/logout — セッションを消す（設計書 §9.2）。入力の一時保存はブラウザ側で消す（clearAllDrafts）
export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonError(403, "このページからは送信できません");
  const name = sessionCookieName();
  const sessionId = readCookie(request, name);
  if (sessionId) await deleteSession(getDb(), sessionId);
  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  response.cookies.set(name, "", cookieAttributes(0));
  return response;
}
