import { getPrincipal } from "@/lib/auth/principal";

// GET /api/me — ログイン中かどうか（設計書 §10 の協会に属さない API）。メールアドレスなどは返さない
export async function GET(): Promise<Response> {
  const principal = await getPrincipal();
  return Response.json(
    {
      loggedIn: principal.sessionState === "active",
      sessionState: principal.sessionState,
      userId: principal.userId,
      isPlatformAdmin: principal.isPlatformAdmin,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
