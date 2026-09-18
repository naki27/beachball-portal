// URL・API の ID（uuid）の形。形が違えば DB に問い合わせずに 404 にする（Postgres の型エラーを 500 にしない）
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}
