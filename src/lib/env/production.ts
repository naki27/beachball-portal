// 本番で必須の環境変数の検査（設計書 §6.3・X-01）。起動時に呼び、足りなければ**変数の名前だけ**を出して止める
// 値はいっさいログに出さない（秘密が混じるため）。P1 の変数（WEBAUTHN_*・MFA_ENCRYPTION_KEY）は見ない

export type EnvRecord = Record<string, string | undefined>;

// どの役割で動いているか。渡す先は Secret ごとに分ける（§6.3「使うサービスにだけ」）
export type EnvRole = "app" | "job-mail" | "job-daily" | "migrate";

export type EnvProblem = { name: string; reason: string };

// 役割ごとに必須の変数。アプリにマイグレーション用・バックアップ用の値は渡さない
const REQUIRED: Record<EnvRole, readonly string[]> = {
  app: [
    "DATABASE_URL",
    "APP_BASE_URL",
    "SESSION_SECRET",
    "LOGIN_CODE_HMAC_KEY",
    "TERMS_VERSION",
    "MAIL_PROVIDER",
    "MAIL_API_KEY",
    "MAIL_FROM",
    "CONTACT_TO",
    "ACCESS_LOG_DRIVER",
    "STORAGE_DRIVER",
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_PUBLIC_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "PUBLIC_FILES_BASE_URL",
  ],
  "job-mail": ["JOB_DATABASE_URL", "APP_BASE_URL", "MAIL_PROVIDER", "MAIL_API_KEY", "MAIL_FROM", "CONTACT_TO"],
  "job-daily": [
    "JOB_DATABASE_URL",
    "BACKUP_ENCRYPTION_KEY",
    "STORAGE_DRIVER",
    "R2_ACCOUNT_ID",
    "R2_BUCKET",
    "R2_PUBLIC_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    // バックアップ用バケットは別のキーで触る（アプリには渡さない）
    "R2_BACKUP_BUCKET",
    "R2_BACKUP_ACCESS_KEY_ID",
    "R2_BACKUP_SECRET_ACCESS_KEY",
  ],
  migrate: ["MIGRATION_DATABASE_URL"],
};

// 接続文字列は TLS を必須にする（Neon・§6.3）
const DATABASE_URL_NAMES = ["DATABASE_URL", "MIGRATION_DATABASE_URL", "JOB_DATABASE_URL", "BACKUP_DATABASE_URL"];

// 鍵・秘密の値の最低の長さ（.env.example の仮の値をそのまま本番に持ち込ませない）
const SECRET_MIN_LENGTH = 32;
const SECRET_NAMES = ["SESSION_SECRET", "LOGIN_CODE_HMAC_KEY", "BREVO_WEBHOOK_TOKEN"];
const PLACEHOLDER = "not-for-production";

export type EnvCheck = {
  // これがあると起動できない
  problems: EnvProblem[];
  // 動くが直したほうがよいもの（ログに名前だけ出す）
  warnings: EnvProblem[];
};

export function isProduction(env: EnvRecord = process.env): boolean {
  return env.NODE_ENV === "production";
}

export function checkProductionEnv(role: EnvRole, env: EnvRecord = process.env): EnvCheck {
  const problems: EnvProblem[] = [];
  const warnings: EnvProblem[] = [];
  const add = (name: string, reason: string) => problems.push({ name, reason });
  const names = REQUIRED[role];
  const has = (name: string) => names.includes(name);

  for (const name of names) {
    if (!env[name]) add(name, "ない");
  }

  if (has("APP_BASE_URL") && env.APP_BASE_URL && !env.APP_BASE_URL.startsWith("https://")) {
    // https でないと Cookie に __Host- と Secure が付かない（§9.2・src/lib/auth/cookies.ts）
    add("APP_BASE_URL", "https:// で始まっていない");
  }
  if (has("MAIL_PROVIDER") && env.MAIL_PROVIDER && env.MAIL_PROVIDER !== "brevo") {
    add("MAIL_PROVIDER", "本番は brevo だけ（§11.2）");
  }
  if (has("STORAGE_DRIVER") && env.STORAGE_DRIVER && env.STORAGE_DRIVER !== "r2") {
    add("STORAGE_DRIVER", "本番は r2 だけ（§6.3）");
  }
  if (has("ACCESS_LOG_DRIVER") && env.ACCESS_LOG_DRIVER && !["stdout", "off"].includes(env.ACCESS_LOG_DRIVER)) {
    // Cloud Run の中にファイルは残らない（docs/adr/0027）
    add("ACCESS_LOG_DRIVER", "本番は stdout か off");
  }

  for (const name of DATABASE_URL_NAMES) {
    const url = env[name];
    if (!url || !has(name)) continue;
    if (!url.includes("sslmode=require")) add(name, "sslmode=require がない");
  }
  // アプリはトランザクション単位のプール経由でつなぐ（§6.3。Neon は -pooler の付いたホスト）
  if (role === "app" && env.DATABASE_URL && !env.DATABASE_URL.includes("-pooler")) {
    warnings.push({ name: "DATABASE_URL", reason: "プール経由（-pooler）に見えない" });
  }

  for (const name of SECRET_NAMES) {
    const value = env[name];
    if (!value) continue;
    if (value.includes(PLACEHOLDER)) add(name, ".env.example の仮の値のまま");
    else if (value.length < SECRET_MIN_LENGTH) add(name, `${SECRET_MIN_LENGTH} 文字より短い`);
  }

  return { problems, warnings };
}

export function formatEnvProblems(role: EnvRole, problems: EnvProblem[]): string {
  const lines = problems.map((p) => `  - ${p.name}: ${p.reason}`).join("\n");
  return `本番の環境変数（${role}）に問題があります。値は出しません:\n${lines}`;
}

// 本番のときだけ検査する。問題があれば投げる（呼ぶ側が止める）
export function assertProductionEnv(role: EnvRole, env: EnvRecord = process.env): void {
  if (!isProduction(env)) return;
  const { problems, warnings } = checkProductionEnv(role, env);
  for (const warning of warnings) console.warn(`環境変数の注意: ${warning.name}: ${warning.reason}`);
  if (problems.length > 0) throw new Error(formatEnvProblems(role, problems));
}
