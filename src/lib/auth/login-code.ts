import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { CODE_LENGTH } from "./login-input";

// 確認番号（設計書 §9.2）の乱数とハッシュ。サーバー専用（node:crypto）。DB は request-login-code.ts / verify（A-09）
// 入力の正規化はブラウザでも使うので login-input.ts にある

// 暗号論的乱数で 6 桁（先頭 0 あり）
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

// 試行 ID（発行したブラウザの Cookie にだけ置く。推測できない）
export function generateAttemptId(): string {
  return randomBytes(32).toString("base64url");
}

// login_codes.attempt_hash = SHA-256(試行 ID)
export function hashAttemptId(attemptId: string): string {
  return createHash("sha256").update(attemptId).digest("hex");
}

// login_codes.code_hash = HMAC-SHA-256(LOGIN_CODE_HMAC_KEY, 試行 ID || code)。6 桁は総当たりできるので鍵付き
export function hashCode(key: string, attemptId: string, code: string): string {
  return createHmac("sha256", key).update(`${attemptId}${code}`).digest("hex");
}

export function codeHashMatches(key: string, attemptId: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(key, attemptId, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// レート制限のキーに使う（メールアドレスそのものを rate_limits に残さない）
export function hashEmailForKey(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 32);
}

export function loginCodeTtlMinutes(): number {
  const n = Number(process.env.LOGIN_CODE_TTL_MINUTES ?? 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

export function loginCodeMaxAttempts(): number {
  const n = Number(process.env.LOGIN_CODE_MAX_ATTEMPTS ?? 5);
  return Number.isFinite(n) && n > 0 ? n : 5;
}
