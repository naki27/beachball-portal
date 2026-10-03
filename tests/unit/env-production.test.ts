import { describe, expect, it } from "vitest";
import { assertProductionEnv, checkProductionEnv, type EnvRecord } from "@/lib/env/production";

// 本番で必須の環境変数の検査（設計書 §6.3・X-01）。値はエラーの文に出さない

const SECRET = "x".repeat(32);

const APP: EnvRecord = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://app_user:pw@ep-x-pooler.ap-southeast-1.aws.neon.tech/beach?sslmode=require",
  APP_BASE_URL: "https://portal.fukuoka-city-beachball.org",
  SESSION_SECRET: SECRET,
  LOGIN_CODE_HMAC_KEY: SECRET,
  TERMS_VERSION: "2027-01-31",
  MAIL_PROVIDER: "brevo",
  MAIL_API_KEY: "xkeysib-secret",
  MAIL_FROM: "no-reply@mail.fukuoka-city-beachball.org",
  CONTACT_TO: "info@example.org",
  ACCESS_LOG_DRIVER: "stdout",
  STORAGE_DRIVER: "r2",
  R2_ACCOUNT_ID: "account",
  R2_BUCKET: "bbp-documents",
  R2_PUBLIC_BUCKET: "bbp-public",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  PUBLIC_FILES_BASE_URL: "https://files.example.workers.dev",
};

const names = (problems: { name: string }[]) => problems.map((p) => p.name);

describe("本番の環境変数（アプリ）", () => {
  it("そろっていれば何も言わない", () => {
    expect(checkProductionEnv("app", APP)).toEqual({ problems: [], warnings: [] });
  });

  it("足りない変数を名前で挙げる", () => {
    const missing = { ...APP, DATABASE_URL: undefined, SESSION_SECRET: undefined };
    expect(names(checkProductionEnv("app", missing).problems)).toEqual(["DATABASE_URL", "SESSION_SECRET"]);
  });

  it("http のサイト・console のメール・local の保存先は本番では通さない", () => {
    const broken = { ...APP, APP_BASE_URL: "http://portal.example.org", MAIL_PROVIDER: "console", STORAGE_DRIVER: "local" };
    expect(names(checkProductionEnv("app", broken).problems)).toEqual(["APP_BASE_URL", "MAIL_PROVIDER", "STORAGE_DRIVER"]);
  });

  it("操作ログをファイルに書く設定は通さない（Cloud Run にファイルは残らない）", () => {
    expect(names(checkProductionEnv("app", { ...APP, ACCESS_LOG_DRIVER: "file" }).problems)).toEqual(["ACCESS_LOG_DRIVER"]);
  });

  it("接続文字列に sslmode=require がなければ通さない", () => {
    const broken = { ...APP, DATABASE_URL: "postgres://app_user:pw@ep-x-pooler.example.tech/beach" };
    expect(checkProductionEnv("app", broken).problems).toEqual([{ name: "DATABASE_URL", reason: "sslmode=require がない" }]);
  });

  it("プール経由に見えなければ注意だけ（止めない）", () => {
    const direct = { ...APP, DATABASE_URL: "postgres://app_user:pw@ep-x.example.tech/beach?sslmode=require" };
    const result = checkProductionEnv("app", direct);
    expect(result.problems).toEqual([]);
    expect(names(result.warnings)).toEqual(["DATABASE_URL"]);
  });

  it(".env.example の仮の値と短すぎる鍵は通さない", () => {
    const broken = { ...APP, SESSION_SECRET: "local-session-secret-not-for-production", LOGIN_CODE_HMAC_KEY: "short" };
    expect(names(checkProductionEnv("app", broken).problems)).toEqual(["SESSION_SECRET", "LOGIN_CODE_HMAC_KEY"]);
  });

  it("アプリにはマイグレーション用・バックアップ用の値を求めない", () => {
    expect(names(checkProductionEnv("app", APP).problems)).toEqual([]);
    expect(names(checkProductionEnv("migrate", { NODE_ENV: "production" }).problems)).toEqual(["MIGRATION_DATABASE_URL"]);
  });
});

describe("本番の環境変数（ジョブ）", () => {
  it("日次ジョブはバックアップ用のバケットと鍵も要る", () => {
    const problems = names(checkProductionEnv("job-daily", { NODE_ENV: "production", JOB_DATABASE_URL: "x" }).problems);
    expect(problems).toContain("R2_BACKUP_ACCESS_KEY_ID");
    expect(problems).toContain("R2_BACKUP_SECRET_ACCESS_KEY");
    expect(problems).toContain("R2_BACKUP_BUCKET");
    expect(problems).toContain("BACKUP_ENCRYPTION_KEY");
  });

  it("送信ジョブは保存先を求めない", () => {
    const env = {
      NODE_ENV: "production",
      JOB_DATABASE_URL: "postgres://app_job:pw@ep-x.example.tech/beach?sslmode=require",
      APP_BASE_URL: "https://portal.example.org",
      MAIL_PROVIDER: "brevo",
      MAIL_API_KEY: "xkeysib-secret",
      MAIL_FROM: "no-reply@example.org",
      CONTACT_TO: "info@example.org",
    };
    expect(checkProductionEnv("job-mail", env)).toEqual({ problems: [], warnings: [] });
  });
});

describe("assertProductionEnv", () => {
  it("本番でなければ何も見ない", () => {
    expect(() => assertProductionEnv("app", { NODE_ENV: "development" })).not.toThrow();
    expect(() => assertProductionEnv("app", {})).not.toThrow();
  });

  it("本番で足りなければ投げる。文に値は入らない", () => {
    const broken = { ...APP, DATABASE_URL: "", MAIL_API_KEY: "" };
    let message = "";
    try {
      assertProductionEnv("app", broken);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).toContain("MAIL_API_KEY");
    // 値（鍵・パスワード・アドレス）は出さない
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("no-reply@");
    expect(message).not.toContain("portal.fukuoka-city-beachball.org");
  });
});
