// Route Handler の共通の補助

// 利用者の IP（レート制限用）。Cloud Run では x-forwarded-for の先頭。取れなければ "unknown"
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

// Cookie ヘッダから 1 つ読む。なければ null
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// JSON の本文を読む。JSON でなければ null
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// multipart/form-data の本文を読む（ファイルのアップロード・§5.9）。形が違えば null
// 大きすぎる本文はメモリに載せる前に Content-Length で弾く（上限の判定そのものは checkPdf）
export async function readFormData(request: Request, maxBytes: number): Promise<FormData | "too_large" | null> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data")) return null;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > maxBytes + 64 * 1024) return "too_large";
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

// FormData の文字列の欄だけを取り出す（File は落とす）。parse… に渡す形にする
export function formFields(form: FormData): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") fields[key] = value;
  return fields;
}
