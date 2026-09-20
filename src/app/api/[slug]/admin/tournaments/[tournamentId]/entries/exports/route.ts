import { getDb } from "@/db/client";
import { exportEntriesCsv } from "@/lib/admin/entries";
import { requireTenantUser, teamErrorResponse } from "@/lib/api/tenant";

type Props = { params: Promise<{ slug: string; tournamentId: string }> };

// POST /api/[slug]/admin/tournaments/[tournamentId]/entries/exports — 申込一覧の CSV（設計書 §5.5(f)・§10）
// 画面のフォームからも押せるよう、JSON でも form でも受ける。生年月日はチェックを入れたときだけ含める（§5.13）
// 出力は export_logs に記録する。2 段階目の再確認は P1（§9.4）
export async function POST(request: Request, { params }: Props): Promise<Response> {
  const { slug, tournamentId } = await params;
  const gate = await requireTenantUser(request, slug);
  if (gate instanceof Response) return gate;

  const contentType = request.headers.get("content-type") ?? "";
  let includeBirthDate = false;
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { include_birth_date?: unknown } | null;
    includeBirthDate = body?.include_birth_date === true;
  } else {
    const form = await request.formData().catch(() => null);
    includeBirthDate = form?.get("include_birth_date") === "on";
  }

  try {
    const csv = await exportEntriesCsv(getDb(), gate.principal, gate.association.id, tournamentId, { includeBirthDate });
    return new Response(csv.body, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${csv.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
